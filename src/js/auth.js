// ═══════════════════════════════════════════
//  IDSJE — Autenticación
// ═══════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Verificar sesión activa y redirigir según rol
export async function verificarSesion(rolRequerido = null) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = './index.html';
        return null;
    }

    const { data: usuario } = await supabase
        .from('usuarios')
        .select('*')
        .eq('correo', session.user.email)
        .single();

    if (!usuario) {
        await supabase.auth.signOut();
        window.location.href = './index.html';
        return null;
    }

    if (rolRequerido && usuario.rol !== rolRequerido && usuario.rol !== 'admin') {
        window.location.href = usuario.rol === 'admin' ? './admin.html' : './docente.html';
        return null;
    }

    return { session, usuario };
}

export async function cerrarSesion() {
    await supabase.auth.signOut();
    window.location.href = './index.html';
}

// Subir foto a Cloudinary
export async function subirFoto(file, cloudName, preset) {
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', preset);
    form.append('folder', 'idsje/alumnos');

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: form
    });
    const data = await res.json();
    return data.secure_url;
}
