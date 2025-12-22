const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
require('dotenv').config();

const padronRoutes = require('./routes/padronRoutes');
const { errorHandler, notFound } = require('./middleware/errorMiddleware');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares globales
app.use(helmet());
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rutas
app.use('/api/padron', padronRoutes);

// Ruta de salud
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'padron-service'
    });
});

// Middleware de errores
app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`🗳️ Servicio de Padrón ejecutándose en puerto ${PORT}`);
    console.log(`🌐 CORS configurado para: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
});

module.exports = app;