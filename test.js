// server.js
import express from 'express';
import { WebSocketServer } from 'ws';
import { CartesiaClient } from '@cartesia/cartesia-js';
import { config } from 'dotenv';

config();

// Initialisation du serveur web
const app = express();
app.use(express.static('public')); // Servir les fichiers du dossier 'public'
const server = app.listen(3000, () => {
    console.log('🌍 Serveur démarré sur http://localhost:3000');
});

// Initialisation du serveur WebSocket
const wss = new WebSocketServer({ server });

// Initialisation du client Cartesia
const cartesiaClient = new CartesiaClient({
    apiKey: process.env.CARTESIA_API_KEY,
});
console.log('✅ Client Cartesia initialisé.');

// Gérer les connexions WebSocket
wss.on('connection', (ws) => {
    console.log('🔗 Nouveau client connecté.');
    let cartesiaSttWs = null;

    ws.on('message', async (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'start_recording':
                console.log('🎙️ Démarrage de la session STT pour le client.');
                cartesiaSttWs = cartesiaClient.stt.websocket({
                    model: "ink-whisper",
                    language: "fr",
                    encoding: "pcm_s16le",
                    sampleRate: 16000,
                });
                
                // Quand Cartesia envoie une transcription, on la renvoie au client
                cartesiaSttWs.onMessage((result) => {
                    if (result.type === 'transcript') {
                        ws.send(JSON.stringify({ type: 'transcription', data: result }));
                    }
                });

                cartesiaSttWs.onOpen(() => ws.send(JSON.stringify({ type: 'status', message: 'Connexion à Cartesia établie.' })));
                cartesiaSttWs.onError((err) => ws.send(JSON.stringify({ type: 'error', message: err.message })));
                break;

            case 'audio_chunk':
                if (cartesiaSttWs && data.chunk) {
                    // Convertir le Float32Array reçu du client en PCM16 pour Cartesia
                    const float32Data = new Float32Array(data.chunk);
                    const pcm16Data = new Int16Array(float32Data.length);
                    for (let i = 0; i < float32Data.length; i++) {
                        pcm16Data[i] = Math.max(-32768, Math.min(32767, float32Data[i] * 32767));
                    }
                    await cartesiaSttWs.send(pcm16Data.buffer);
                }
                break;

            case 'stop_recording':
                console.log('🛑 Arrêt de la session STT.');
                if (cartesiaSttWs) {
                    await cartesiaSttWs.finalize();
                    cartesiaSttWs.disconnect();
                    cartesiaSttWs = null;
                }
                break;
        }
    });

    ws.on('close', () => {
        console.log('👋 Client déconnecté.');
        if (cartesiaSttWs) {
            cartesiaSttWs.disconnect();
        }
    });
});