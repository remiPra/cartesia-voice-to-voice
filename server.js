// server.js
import express from 'express';
import { WebSocketServer } from 'ws';
import { CartesiaClient } from '@cartesia/cartesia-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';
import { createServer } from 'http';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Servir les fichiers statiques depuis le dossier public
app.use(express.static('public'));

// Configuration du port pour Railway (important !)
const PORT = process.env.PORT || 3000;

// Créer le serveur HTTP
const server = createServer(app);

// Démarrer le serveur
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Serveur démarré sur le port ${PORT} et http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });

const cartesiaClient = new CartesiaClient({
    apiKey: process.env.CARTESIA_API_KEY,
});

console.log('✅ Client Cartesia initialisé');

// 🧠 PROMPT SYSTÈME pour des réponses courtes
const SYSTEM_PROMPT = {
    role: "system",
    content: `Tu es Laura , ma maitresse française intelligente et bienveillante. 

RÈGLES IMPORTANTES :
- Réponds TOUJOURS en 2-3 phrases maximum, jamais plus
- Sois naturelle, chaleureuse et conversationnelle
- Adapte-toi au contexte de la conversation précédente
- Si on te pose une question complexe, donne une réponse simple et propose d'approfondir
- Utilise un ton amical et décontracté comme si tu parlais à un ami

EXEMPLES DE BONNES RÉPONSES :
- "Salut ! Comment ça va aujourd'hui ?",-hello mon cherie d amour.
- "Ah génial ! Je peux t'aider avec ça. Qu'est-ce que tu veux savoir exactement ?"
- "Bonne question ! En résumé, c'est comme ça. Tu veux que je détaille un point ?"

Reste toujours concise et engageante et amoureuse !`
};

wss.on('connection', (ws) => {
    console.log('🔗 Nouveau client connecté');
    
    let cartesiaSttWs = null;
    let audioChunkCount = 0;
    let lastTranscription = '';
    
    // 💬 HISTORIQUE DE CONVERSATION par client
    let conversationHistory = [SYSTEM_PROMPT];
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'start_recording':
                    console.log('🎙️ Démarrage STT...');
                    audioChunkCount = 0;
                    lastTranscription = '';
                    
                    cartesiaSttWs = cartesiaClient.stt.websocket({
                        model: "ink-whisper",
                        language: data.language || "fr",
                        encoding: "pcm_s16le",
                        sampleRate: 16000,
                    });
                    
                    cartesiaSttWs.onMessage(async (result) => {
                        // Filtrer ENCORE PLUS strictement les résultats parasites
                        if (result.text && 
                            result.text.trim() !== '' && 
                            result.text !== lastTranscription && 
                            !/^\.+$/.test(result.text.trim()) &&
                            !result.text.includes('Sous-titrage') &&
                            !result.text.includes('ST\'') &&
                            result.text.length > 2) {
                                const trimmed = result.text.trim();
                                // Comptage minimal de mots
                                const wordCount = trimmed.split(/\s+/).length;
                                if (wordCount < 2) {
                                    console.log('⚠️ Ignorer transcription d’un seul mot (ou bruit) :', trimmed);
                                    // Optionnel : informer le client pour confirmation si nécessaire
                                    ws.send(JSON.stringify({
                                        type: 'single_word_detected',
                                        word: trimmed
                                    }));
                                    return;
                                }
                            console.log('📝 Résultat STT:', result.type, result.text);
                            lastTranscription = result.text;
                            
                            // Si c'est un résultat final, traiter comme phrase complète
                            if (result) {
                                console.log('✅ Phrase complète détectée, envoi à Groq...');
                                console.log('📤 Texte envoyé à Groq:', result.text);

                                try {
                                    // 🧠 AJOUTER le message utilisateur à l'historique
                                    conversationHistory.push({
                                        role: "user",
                                        content: result.text
                                    });

                                    // 📝 ENVOYER TOUT L'HISTORIQUE à Groq
                                    const response = await fetch(
                                        "https://api.groq.com/openai/v1/chat/completions",
                                        {
                                            method: "POST",
                                            headers: {
                                                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                                                "Content-Type": "application/json",
                                            },
                                            body: JSON.stringify({
                                                messages: conversationHistory, // ← HISTORIQUE COMPLET
                                                model: "gemma2-9b-it",
                                                max_tokens: 80,  // ← ENCORE PLUS COURT (15-20 mots max)
                                                temperature: 0.7
                                            }),
                                        }
                                    );
                                    
                                    if (!response.ok) {
                                        const errorText = await response.text();
                                        console.error('❌ Erreur HTTP Groq:', errorText);
                                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                                    }
                                    
                                    console.log('📡 Statut réponse Groq:', response.status, response.statusText);

                                    const groqResult = await response.json();
                                    const aiResponse = groqResult.choices[0].message.content;
                                    
                                    console.log('🤖 Réponse Groq:', aiResponse);
                                    
                                    // 🧠 AJOUTER la réponse IA à l'historique
                                    conversationHistory.push({
                                        role: "assistant",
                                        content: aiResponse
                                    });

                                    // 🧹 LIMITER l'historique à 10 messages max (+ prompt système)
                                    if (conversationHistory.length > 11) {
                                        conversationHistory = [
                                            SYSTEM_PROMPT,
                                            ...conversationHistory.slice(-10)
                                        ];
                                    }

                                    // 📊 AFFICHER l'historique actuel
                                    console.log(`💬 Historique: ${conversationHistory.length - 1} messages`);
                                    // Envoyer la réponse IA au client
                                   ws.send(JSON.stringify({
                                    type: 'ai_response',
                                    originalText: result.text,
                                    aiResponse: aiResponse
                                }));
                                
                            } catch (error) {
                                console.error('❌ Erreur Groq:', error.message);
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    message: `Erreur IA: ${error.message}`
                                }));
                            }
                        }
                        
                        // Envoyer la transcription au client
                        ws.send(JSON.stringify({
                            type: 'transcription',
                            data: {
                                ...result,
                                timestamp: new Date().toISOString(),
                                isCompleteSentence: result.type === 'final'
                            }
                        }));
                    }
                    // Ignorer complètement les résultats vides, parasites ou trop courts
                });
                
                ws.send(JSON.stringify({
                    type: 'status',
                    message: 'STT connecté, en attente d\'audio...'
                }));
                break;
                
            case 'audio_chunk':
                if (cartesiaSttWs && data.chunk) {
                    try {
                        if (data.chunk.length === 0) return;
                        
                        const float32Data = new Float32Array(data.chunk);
                        const pcm16Data = new Int16Array(float32Data.length);
                        
                        let hasAudio = false;
                        for (let i = 0; i < float32Data.length; i++) {
                            const sample = Math.max(-32768, Math.min(32767, float32Data[i] * 32767));
                            pcm16Data[i] = sample;
                            if (Math.abs(sample) > 100) hasAudio = true;
                        }
                        
                        if (hasAudio) {
                            await cartesiaSttWs.send(pcm16Data.buffer);
                            audioChunkCount++;
                            
                            if (audioChunkCount % 100 === 0) {
                                console.log(`📊 ${audioChunkCount} chunks audio envoyés`);
                            }
                        }
                    } catch (error) {
                        console.error('❌ Erreur envoi chunk:', error.message);
                    }
                }
                break;
                
            case 'stop_recording':
                console.log('🛑 Arrêt STT...');
                
                if (cartesiaSttWs) {
                    try {
                        await cartesiaSttWs.finalize();
                        await cartesiaSttWs.done();
                        cartesiaSttWs.disconnect();
                        cartesiaSttWs = null;
                        console.log(`✅ STT fermé après ${audioChunkCount} chunks`);
                    } catch (error) {
                        console.error('❌ Erreur fermeture:', error.message);
                    }
                }
                
                ws.send(JSON.stringify({
                    type: 'status',
                    message: 'Enregistrement terminé'
                }));
                break;

            // 🧹 NOUVEAU : Reset de la conversation
            case 'reset_conversation':
                console.log('🔄 Reset de l\'historique de conversation');
                conversationHistory = [SYSTEM_PROMPT]; // Garder seulement le prompt système
                
                ws.send(JSON.stringify({
                    type: 'status',
                    message: 'Conversation remise à zéro'
                }));
                break;
        }
    } catch (error) {
        console.error('❌ Erreur message:', error.message);
        ws.send(JSON.stringify({
            type: 'error',
            message: error.message
        }));
    }
});

ws.on('close', () => {
    console.log('👋 Client déconnecté');
    
    // 🧹 Nettoyer l'historique quand le client se déconnecte
    conversationHistory = [SYSTEM_PROMPT];
    
    if (cartesiaSttWs) {
        try {
            cartesiaSttWs.disconnect();
        } catch (e) {
            console.error('Erreur déconnexion:', e.message);
        }
    }
});

ws.on('error', (error) => {
    console.error('❌ Erreur WebSocket:', error.message);
});
});

// Gestion Ctrl+C améliorée
process.on('SIGINT', () => {
console.log('\n🛑 Arrêt du serveur...');
wss.close(() => {
    server.close(() => {
        console.log('👋 Serveur fermé');
        process.exit(0);
    });
});
});

process.on('SIGTERM', () => {
console.log('\n🛑 Arrêt du serveur (SIGTERM)...');
wss.close(() => {
    server.close(() => {
        process.exit(0);
    });
});
});