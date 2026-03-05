function userContextMiddleware(req, res, next) {
    const userId = req.headers['x-user-id'];
    const username = req.headers['x-user-username'];
    const nombreCompleto = req.headers['x-user-nombre'];
    const rol = req.headers['x-user-rol'];

    if (userId) {
        req.user = {
            id: parseInt(userId),
            username: username || '',
            nombre_completo: nombreCompleto ? decodeURIComponent(nombreCompleto) : '',
            rol: rol || ''
        };
    }

    next();
}

module.exports = userContextMiddleware;
