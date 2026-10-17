// Fallback de dictado con Whisper para navegadores sin SpeechRecognition (Firefox/Safari).
// Graba con MediaRecorder y envía a /api/stt (OpenAI-compatible: Groq por defecto).
(function(){
  window.ciSTTFallback = async function({ btn, input, onStop }) {
    const w = window;
    if (!w.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Tu navegador no soporta dictado por voz. Usa Chrome o Edge para el micrófono nativo.');
      return;
    }
    if (w._ciSttRecorder && w._ciSttRecorder.recording) {
      w._ciSttRecorder.stop();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      alert('No hay permiso de micrófono. Habilítalo en la configuración del navegador.');
      return;
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const chunks = [];
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      btn.classList.remove('recording');
      btn.disabled = true;
      if (onStop) onStop(null);
      let text = '';
      const token = localStorage.getItem('chessinvest_token');
      let prev = String(input.value || '').trim();
      if (prev.endsWith('…')) prev = prev.slice(0, -1).trim();
      try {
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const b64 = await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(',')[1] || '');
          fr.readAsDataURL(blob);
        });
        const r = await fetch('/api/stt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ audio: b64, mime: rec.mimeType || 'audio/webm' }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (r.status === 501) throw new Error('501');
          throw new Error(d.error || 'Transcripción no disponible');
        }
        text = (d.text || '').trim();
        input.value = prev ? prev + (text ? ' ' + text : '') : text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      } catch (e) {
        input.value = prev;
        if (e.message === '501') {
          alert('Dictado con Whisper no está configurado en el servidor. Añade STT_API_KEY en el entorno (Groq gratis) o usa Chrome/Edge, que tienen dictado nativo.');
        } else {
          alert('No se pudo transcribir el audio. ' + (e.message || ''));
        }
      }
      btn.disabled = false;
      if (text && onStop) onStop(text);
    };
    w._ciSttRecorder = rec;
    rec.start();
    btn.classList.add('recording');
    if (onStop) onStop('_listening');
  };
})();
