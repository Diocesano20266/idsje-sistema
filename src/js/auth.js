// ═══════════════════════════════════════════
//  IDSJE — Autenticación
// ═══════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { esErrorDeRed, mostrarBannerSinConexion, ocultarBannerSinConexion } from './utils.js';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CLAVE_MENSAJE_LOGIN = 'idsje_mensaje_login';

// Distingue un cierre de sesión manual (cerrarSesion()) de uno automático
// (token expirado / revocado), para no mostrar "tu sesión expiró" al hacer logout normal.
let cerrandoSesionManualmente = false;

supabase.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT' || cerrandoSesionManualmente) return;

    const enPantallaDeLogin = /\/index\.html$/.test(location.pathname) || location.pathname === '/' || location.pathname.endsWith('/');
    if (enPantallaDeLogin) return;

    sessionStorage.setItem(CLAVE_MENSAJE_LOGIN, 'Tu sesión expiró. Iniciá sesión nuevamente.');
    window.location.href = './index.html';
});

// Verificar sesión activa y redirigir según rol
export async function verificarSesion(rolRequerido = null) {
    let session;
    try {
        const res = await supabase.auth.getSession();
        session = res.data.session;
        ocultarBannerSinConexion();
    } catch (err) {
        if (esErrorDeRed(err)) {
            mostrarBannerSinConexion(() => verificarSesion(rolRequerido));
            return null;
        }
        throw err;
    }

    if (!session) {
        window.location.href = './index.html';
        return null;
    }

    let usuario;
    try {
        const res = await supabase
            .from('usuarios')
            .select('*')
            .eq('correo', session.user.email)
            .single();
        if (res.error && esErrorDeRed(res.error)) {
            mostrarBannerSinConexion(() => verificarSesion(rolRequerido));
            return null;
        }
        usuario = res.data;
    } catch (err) {
        if (esErrorDeRed(err)) {
            mostrarBannerSinConexion(() => verificarSesion(rolRequerido));
            return null;
        }
        throw err;
    }

    if (!usuario) {
        cerrandoSesionManualmente = true;
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
    cerrandoSesionManualmente = true;
    await supabase.auth.signOut();
    window.location.href = './index.html';
}

// Si venimos de un redirect con mensaje pendiente (ej. sesión expirada), lo muestra una vez.
// Se llama desde index.html.
export function mostrarMensajeLoginPendiente(mostrarToastFn) {
    const mensaje = sessionStorage.getItem(CLAVE_MENSAJE_LOGIN);
    if (!mensaje) return;
    sessionStorage.removeItem(CLAVE_MENSAJE_LOGIN);
    mostrarToastFn(mensaje, 'advertencia');
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
