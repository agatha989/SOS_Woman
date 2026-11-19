const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDirectory = __dirname;
const dataDirectory = path.join(__dirname, 'data');
const databasePath = path.join(dataDirectory, 'relatos.sqlite');

fs.mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS relatos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        texto TEXT NOT NULL CHECK (length(texto) BETWEEN 1 AND 4000),
        criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

const inserirRelato = database.prepare(
    'INSERT INTO relatos (texto) VALUES (?)'
);

const tentativas = new Map();
const JANELA_RATE_LIMITO_MS = 15 * 60 * 1000;
const MAXIMO_RELATOS_POR_JANELA = 5;

app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; frame-src https://www.google.com; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com");
    next();
});
app.use(express.json({ limit: '12kb' }));

function limitarRelatos(req, res, next) {
    const agora = Date.now();
    const chave = req.ip || 'desconhecido';
    const registro = tentativas.get(chave);

    if (!registro || agora - registro.inicio >= JANELA_RATE_LIMITO_MS) {
        tentativas.set(chave, { inicio: agora, quantidade: 1 });
        return next();
    }

    if (registro.quantidade >= MAXIMO_RELATOS_POR_JANELA) {
        return res.status(429).json({
            erro: 'Muitas tentativas. Aguarde alguns minutos antes de enviar outro relato.'
        });
    }

    registro.quantidade += 1;
    return next();
}

app.post('/api/relatos', limitarRelatos, (req, res) => {
    const texto = typeof req.body?.texto === 'string'
        ? req.body.texto.trim()
        : '';

    if (texto.length < 1 || texto.length > 4000) {
        return res.status(400).json({
            erro: 'O relato deve conter entre 1 e 4000 caracteres.'
        });
    }

    try {
        inserirRelato.run(texto);
        return res.status(201).json({
            mensagem: 'Relato recebido com segurança.'
        });
    } catch (erro) {
        console.error('Falha ao salvar relato:', erro);
        return res.status(500).json({
            erro: 'Não foi possível salvar o relato. Tente novamente.'
        });
    }
});

app.use((req, res, next) => {
    const caminho = req.path.toLowerCase();
    const recursoPrivado = caminho === '/data'
        || caminho.startsWith('/data/')
        || ['/server.js', '/package.json', '/package-lock.json'].includes(caminho);

    if (recursoPrivado) {
        return res.status(404).json({ erro: 'Recurso não encontrado.' });
    }

    return next();
});

app.use(express.static(publicDirectory, {
    extensions: ['html'],
    index: 'index.html'
}));

app.use((req, res) => {
    res.status(404).json({ erro: 'Recurso não encontrado.' });
});

const servidor = app.listen(port, () => {
    console.log(`SOS WOMAN disponível em http://localhost:${port}`);
});

function encerrar() {
    servidor.close(() => {
        database.close();
        process.exit(0);
    });
}

process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
