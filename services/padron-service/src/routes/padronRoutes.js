const express = require('express');
const router = express.Router();
const multer = require('multer');
const PadronController = require('../controllers/PadronController');
const userContextMiddleware = require('../middleware/userContextMiddleware');

// Apply user context middleware to all routes
router.use(userContextMiddleware);

// Instancia del controlador
const padronController = new PadronController();

// Configurar multer para subida de archivos
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'text/csv' && !file.originalname.endsWith('.csv')) {
            return cb(new Error('Solo se permiten archivos CSV'));
        }
        cb(null, true);
    }
});

// Rutas
router.post('/importar-csv', upload.single('csv'), (req, res) => {
    padronController.cargarCSV(req, res);
});

router.get('/votantes', (req, res) => {
    padronController.obtenerVotantes(req, res);
});

router.post('/votantes', (req, res) => {
    padronController.crearVotante(req, res);
});

router.get('/votantes/:dni', (req, res) => {
    padronController.obtenerVotantePorDni(req, res);
});

router.get('/relevamientos/:dni', (req, res) => {
    padronController.obtenerRelevamiento(req, res);
});

router.put('/relevamientos/:dni', (req, res) => {
    padronController.actualizarRelevamiento(req, res);
});

router.get('/estadisticas', (req, res) => {
    padronController.obtenerEstadisticas(req, res);
});

router.get('/exportar-relevamientos', (req, res) => {
    padronController.exportarRelevamientosCSV(req, res);
});

router.get('/exportar-padron', (req, res) => {
    padronController.exportarPadronCSV(req, res);
});

router.get('/estado', (req, res) => {
    padronController.obtenerEstado(req, res);
});

router.get('/health', (req, res) => {
    padronController.healthCheck(req, res);
});

router.get('/filtros', (req, res) => {
    padronController.obtenerFiltrosDisponibles(req, res);
});

router.get('/configuracion', (req, res) => {
    padronController.obtenerConfiguracion(req, res);
});

// Rutas para Resultados
router.get('/resultados/estadisticas-avanzadas', (req, res) => {
    padronController.obtenerEstadisticasAvanzadas(req, res);
});

router.get('/resultados/por-sexo', (req, res) => {
    padronController.obtenerEstadisticasPorSexo(req, res);
});

router.get('/resultados/por-rango-etario', (req, res) => {
    padronController.obtenerEstadisticasPorRangoEtario(req, res);
});

router.get('/resultados/por-circuito', (req, res) => {
    padronController.obtenerEstadisticasPorCircuito(req, res);
});

router.get('/resultados/condiciones-detalladas', (req, res) => {
    padronController.obtenerEstadisticasCondicionesDetalladas(req, res);
});

// ==================== RUTAS DETALLE VOTANTE ====================

// Crear o actualizar detalle de votante
router.post('/detalle-votante', (req, res) => {
    padronController.crearOActualizarDetalleVotante(req, res);
});

// Obtener detalle de votante por DNI
router.get('/detalle-votante/:dni', (req, res) => {
    padronController.obtenerDetalleVotante(req, res);
});

// Obtener votantes con condiciones especiales
router.get('/condiciones-especiales', (req, res) => {
    padronController.obtenerVotantesCondicionesEspeciales(req, res);
});

// Obtener estadísticas de condiciones especiales
router.get('/estadisticas-condiciones-especiales', (req, res) => {
    padronController.obtenerEstadisticasCondicionesEspeciales(req, res);
});

// Eliminar detalle de votante
router.delete('/detalle-votante/:dni', (req, res) => {
    padronController.eliminarDetalleVotante(req, res);
});

// ==================== RUTAS DE AUDITORIA ====================

router.get('/auditoria', (req, res) => {
    padronController.obtenerAuditoria(req, res);
});

router.get('/auditoria/estadisticas', (req, res) => {
    padronController.obtenerEstadisticasAuditoria(req, res);
});

module.exports = router;