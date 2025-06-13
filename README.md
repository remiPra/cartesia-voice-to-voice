# cartesia-voice-to-voice

## Objectif

Ce projet propose un assistant vocal capable de transcrire la parole
en texte et de synthétiser les réponses. Il s'appuie sur la plateforme
**Cartesia** pour la reconnaissance (STT) et la synthèse vocale (TTS),
et utilise **Groq** pour générer les réponses.

## Installation

```bash
npm install
```

Créez ensuite un fichier `.env` à la racine contenant vos clés
d'API :

```env
CARTESIA_API_KEY=your_cartesia_key
GROQ_API_KEY=your_groq_key
```

Lancez le serveur avec :

```bash
npm start
```

Par défaut, le serveur écoute sur le port **3000**.

## Configuration TTS

Pour renseigner la clé de synthèse vocale, éditez le fichier
`public/index.html` et modifiez la valeur de `X-API-Key`. Vous pouvez
également ajuster `voiceId` si nécessaire.

## Scripts npm

- `npm start` – lance `server.js`.
- `npm dev` – exécute `server.js` en mode veille (`node --watch`).

