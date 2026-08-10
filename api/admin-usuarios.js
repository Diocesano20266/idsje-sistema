// ═══════════════════════════════════════════
//  IDSJE — API Admin: gestión de docentes
//  (usa SUPABASE_SERVICE_KEY solo en el servidor)
// ═══════════════════════════════════════════
const SUPABASE_URL = 'https://xhprlhvtdyhghhhjdztd.supabase.co';

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) {
        return res.status(500).json({ error: 'Falta configurar SUPABASE_SERVICE_KEY en el servidor' });
    }

    // 1. Verificar que quien llama tiene una sesión válida y es admin
    const accessToken = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!accessToken) {
        return res.status(401).json({ error: 'No autenticado' });
    }

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    if (!userRes.ok) {
        return res.status(401).json({ error: 'Sesión inválida' });
    }
    const callerUser = await userRes.json();

    const perfilRes = await fetch(
        `${SUPABASE_URL}/rest/v1/usuarios?correo=eq.${encodeURIComponent(callerUser.email)}&select=rol`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const perfil = await perfilRes.json();
    if (!perfilRes.ok || !perfil[0] || perfil[0].rol !== 'admin') {
        return res.status(403).json({ error: 'No autorizado' });
    }

    // 2. Ejecutar la acción solicitada
    const { action, correo, password } = req.body || {};

    try {
        if (action === 'crear') {
            if (!correo || !password || password.length < 6) {
                return res.status(400).json({ error: 'Correo y contraseña (mín. 6 caracteres) son obligatorios' });
            }

            const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
                method: 'POST',
                headers: {
                    apikey: serviceKey,
                    Authorization: `Bearer ${serviceKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email: correo, password, email_confirm: true })
            });
            const createData = await createRes.json();
            if (!createRes.ok) {
                return res.status(createRes.status).json({ error: createData.message || createData.msg || 'Error creando cuenta' });
            }
            return res.status(200).json({ id: createData.id });
        }

        if (action === 'cambiar-password') {
            if (!correo || !password || password.length < 6) {
                return res.status(400).json({ error: 'Correo y contraseña (mín. 6 caracteres) son obligatorios' });
            }

            const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(correo)}`, {
                headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
            });
            const listData = await listRes.json();
            const target = listData.users?.find(u => u.email?.toLowerCase() === correo.toLowerCase());
            if (!target) {
                return res.status(404).json({ error: 'Usuario no encontrado en Supabase Auth' });
            }

            const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${target.id}`, {
                method: 'PUT',
                headers: {
                    apikey: serviceKey,
                    Authorization: `Bearer ${serviceKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password })
            });
            const updateData = await updateRes.json();
            if (!updateRes.ok) {
                return res.status(updateRes.status).json({ error: updateData.message || updateData.msg || 'Error actualizando contraseña' });
            }
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Acción no reconocida' });
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Error interno' });
    }
};
