// public/script.js
class DicteeLive {
    constructor() {
        this.ws = null;
        this.audioContext = null;
        this.mediaStream = null;
        this.processor = null;
        this.isRecording = false;
        this.startTime = null;
        this.fullTranscript = '';
        
        this.initElements();
        this.connectWebSocket();
        this.setupEventListeners();
    }
    
    initElements() {
        this.recordBtn = document.getElementById('recordBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.languageSelect = document.getElementById('languageSelect');
        this.status = document.getElementById('status');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.transcript = document.getElementById('transcript');
        this.interimText = document.getElementById('interimText');
        this.wordCount = document.getElementById('wordCount');
        this.duration = document.getElementById('duration');
    }
    
    connectWebSocket() {
        const wsUrl = `ws://${window.location.host}`;
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('✅ WebSocket connecté');
            this.connectionStatus.textContent = '🟢 Connecté';
            this.connectionStatus.className = 'connection connected';
            this.status.textContent = '📢 Prêt à démarrer';
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleServerMessage(data);
        };
        
        this.ws.onclose = () => {
            console.log('❌ WebSocket fermé');
            this.connectionStatus.textContent = '🔴 Déconnecté';
            this.connectionStatus.className = 'connection disconnected';
        };
        
        this.ws.onerror = (error) => {
            console.error('❌ Erreur WebSocket:', error);
        };
    }
    
    setupEventListeners() {
        this.recordBtn.addEventListener('click', () => {
            if (this.isRecording) {
                this.stopRecording();
            } else {
                this.startRecording();
            }
        });
        
        this.clearBtn.addEventListener('click', () => {
            this.clearTranscript();
        });
        
        setInterval(() => {
            if (this.isRecording && this.startTime) {
                const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
                const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
                const seconds = (elapsed % 60).toString().padStart(2, '0');
                this.duration.textContent = `${minutes}:${seconds}`;
            }
        }, 1000);
    }
    
    async startRecording() {
        try {
            console.log('🎙️ Démarrage enregistrement...');
            
            // Obtenir le flux audio
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            });
            
            // Créer le contexte audio
            this.audioContext = new AudioContext({ sampleRate: 16000 });
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            
            // Créer un processeur audio pour capturer les données
            this.processor = this.audioContext.createScriptProcessor(1024, 1, 1);
            
            this.processor.onaudioprocess = (event) => {
                if (this.isRecording) {
                    const audioData = event.inputBuffer.getChannelData(0);
                    // Envoyer les données audio au serveur
                    this.sendAudioChunk(Array.from(audioData));
                }
            };
            
            // Connecter les nœuds audio
            source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            
            // Démarrer l'enregistrement côté serveur
            this.ws.send(JSON.stringify({
                type: 'start_recording',
                language: this.languageSelect.value
            }));
            
            this.isRecording = true;
            this.startTime = Date.now();
            
            this.recordBtn.textContent = '🛑 Arrêter';
            this.recordBtn.className = 'btn-record recording';
            this.status.textContent = '🔴 Enregistrement et traitement en cours...';
            
            console.log('✅ Enregistrement démarré');
            
        } catch (error) {
            console.error('❌ Erreur démarrage:', error);
            this.status.textContent = '❌ Erreur: ' + error.message;
            
            // Vérifier les permissions
            if (error.name === 'NotAllowedError') {
                this.status.textContent = '❌ Permission microphone refusée';
            }
        }
    }
    
    sendAudioChunk(audioData) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'audio_chunk',
                chunk: audioData
            }));
        }
    }
    
    stopRecording() {
        console.log('🛑 Arrêt enregistrement...');
        
        this.isRecording = false;
        
        // Nettoyer les ressources audio
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        
        // Arrêter côté serveur
        this.ws.send(JSON.stringify({
            type: 'stop_recording'
        }));
        
        this.startTime = null;
        
        this.recordBtn.textContent = '🎙️ Commencer';
        this.recordBtn.className = 'btn-record stopped';
        this.status.textContent = '⏹️ Enregistrement arrêté';
        
        console.log('✅ Enregistrement arrêté');
    }
    
    handleServerMessage(data) {
        switch (data.type) {
            case 'transcription':
                this.handleTranscription(data.data);
                break;
                
            case 'status':
                this.status.textContent = data.message;
                console.log('📊 Serveur:', data.message);
                break;
                
            case 'error':
                console.error('❌ Erreur serveur:', data.message);
                this.status.textContent = '❌ ' + data.message;
                break;
        }
    }
    
    handleTranscription(result) {
        console.log('📝 Transcription reçue:', result);
        
        if (result.type === 'transcript') {
            const timestamp = new Date().toLocaleTimeString();
            
            if (result.isFinal) {
                console.log('✅ FINAL:', result.text);
                
                // Transcription finale
                this.fullTranscript += result.text + ' ';
                
                const finalText = document.createElement('div');
                finalText.innerHTML = `<strong>[${timestamp}]</strong> ${result.text}`;
                finalText.style.marginBottom = '0.5rem';
                finalText.style.color = '#2c3e50';
                
                // Effacer le placeholder
                const placeholder = this.transcript.querySelector('.placeholder');
                if (placeholder) {
                    placeholder.remove();
                }
                
                this.transcript.appendChild(finalText);
                this.transcript.scrollTop = this.transcript.scrollHeight;
                
                // Effacer le texte intérimaire
                this.interimText.textContent = '';
                
                this.updateWordCount();
                
            } else {
                console.log('⏳ INTERIM:', result.text);
                // Transcription intérimaire
                this.interimText.textContent = `⏳ ${result.text}`;
            }
        } else if (result.type === 'error') {
            console.error('❌ Erreur STT:', result.message);
            this.status.textContent = '❌ Erreur STT: ' + result.message;
        }
    }
    
    clearTranscript() {
        this.transcript.innerHTML = '<div class="placeholder">Cliquez sur le micro pour commencer à dicter...</div>';
        this.interimText.textContent = '';
        this.fullTranscript = '';
        this.updateWordCount();
    }
    
    updateWordCount() {
        const words = this.fullTranscript.trim().split(/\s+/).filter(word => word.length > 0);
        this.wordCount.textContent = words.length;
    }
}

// Démarrer l'application
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initialisation Dictée Live...');
    new DicteeLive();
});