const nodemailer = require('nodemailer');
const { get } = require('./database');
const logger = require('./logger');

const config = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || 'CHESS INVEST <noreply@chessinvest.com>',
};

let transporter = null;

function isConfigured() {
  return Boolean(config.user && config.pass);
}

function getTransporter() {
  if (transporter) return transporter;
  if (!isConfigured()) return null;
  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });
  return transporter;
}

const TEMPLATES = {
  signal: (data) => ({
    subject: `📊 Señal de Trading: ${data.asset} ${data.direction}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #0a0e1a; color: #e8f4f8; border-radius: 16px; overflow: hidden; border: 1px solid rgba(0,212,255,0.15);">
        <div style="background: linear-gradient(135deg, #00d4ff, #0099cc); padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; color: #000;">♔ CHESS INVEST</h1>
          <p style="margin: 4px 0 0; font-size: 12px; color: rgba(0,0,0,0.7);">Señal de Trading Automática</p>
        </div>
        <div style="padding: 24px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <span style="font-size: 28px; font-weight: bold; color: ${data.direction === 'LARGO' ? '#00e676' : '#ff4444'};">${data.direction}</span>
            <div style="font-size: 36px; font-weight: bold; color: #00d4ff; font-family: monospace; margin-top: 8px;">${data.asset}</div>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
            ${data.entry ? `<tr><td style="padding: 8px 12px; color: #7a9bb5; font-size: 13px; border-bottom: 1px solid rgba(0,212,255,0.1);">Entrada</td><td style="padding: 8px 12px; text-align: right; font-size: 13px; font-family: monospace; border-bottom: 1px solid rgba(0,212,255,0.1);">${data.entry}</td></tr>` : ''}
            ${data.stopLoss ? `<tr><td style="padding: 8px 12px; color: #7a9bb5; font-size: 13px; border-bottom: 1px solid rgba(0,212,255,0.1);">Stop Loss</td><td style="padding: 8px 12px; text-align: right; font-size: 13px; font-family: monospace; border-bottom: 1px solid rgba(0,212,255,0.1); color: #ff4444;">${data.stopLoss}</td></tr>` : ''}
            ${data.takeProfit ? `<tr><td style="padding: 8px 12px; color: #7a9bb5; font-size: 13px; border-bottom: 1px solid rgba(0,212,255,0.1);">Take Profit</td><td style="padding: 8px 12px; text-align: right; font-size: 13px; font-family: monospace; border-bottom: 1px solid rgba(0,212,255,0.1); color: #00e676;">${data.takeProfit}</td></tr>` : ''}
            ${data.confidence ? `<tr><td style="padding: 8px 12px; color: #7a9bb5; font-size: 13px; border-bottom: 1px solid rgba(0,212,255,0.1);">Confianza</td><td style="padding: 8px 12px; text-align: right; font-size: 13px; border-bottom: 1px solid rgba(0,212,255,0.1);">${data.confidence}%</td></tr>` : ''}
            ${data.riskReward ? `<tr><td style="padding: 8px 12px; color: #7a9bb5; font-size: 13px;">R/R</td><td style="padding: 8px 12px; text-align: right; font-size: 13px; font-family: monospace;">${data.riskReward}</td></tr>` : ''}
          </table>
          ${data.rationale ? `<div style="background: rgba(0,212,255,0.05); border: 1px solid rgba(0,212,255,0.1); border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 12px; line-height: 1.6; color: #7a9bb5;">${data.rationale}</div>` : ''}
          <a href="${process.env.APP_URL || 'https://chessinvest.onrender.com'}/stockbroker" style="display: block; text-align: center; padding: 12px; background: #00d4ff; color: #000; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;">Ver en Chess Invest</a>
        </div>
        <div style="padding: 16px; text-align: center; border-top: 1px solid rgba(0,212,255,0.1); font-size: 11px; color: #7a9bb5;">
          CHESS INVEST © ${new Date().getFullYear()} — Análisis automatizado con IA
        </div>
      </div>`,
  }),
  alert: (data) => ({
    subject: `⚠️ Alerta de Mercado: ${data.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #0a0e1a; color: #e8f4f8; border-radius: 16px; overflow: hidden; border: 1px solid rgba(0,212,255,0.15);">
        <div style="background: linear-gradient(135deg, #ffb300, #ff8f00); padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; color: #000;">⚠️ Alerta</h1>
        </div>
        <div style="padding: 24px;">
          <h2 style="font-size: 16px; margin: 0 0 8px; color: #ffb300;">${data.title}</h2>
          ${data.body ? `<p style="font-size: 13px; line-height: 1.6; color: #7a9bb5;">${data.body}</p>` : ''}
        </div>
      </div>`,
  }),
  recommendation: (data) => ({
    subject: `💡 Recomendación: ${data.ticker}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #0a0e1a; color: #e8f4f8; border-radius: 16px; overflow: hidden; border: 1px solid rgba(0,212,255,0.15);">
        <div style="background: linear-gradient(135deg, #b388ff, #7c4dff); padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; color: #fff;">💡 Nueva Recomendación</h1>
        </div>
        <div style="padding: 24px;">
          <div style="text-align: center; margin-bottom: 16px;">
            <span style="font-size: 32px; font-weight: bold; color: #00d4ff; font-family: monospace;">${data.ticker}</span>
            ${data.score ? `<div style="margin-top: 8px;"><span style="background: rgba(0,230,118,0.15); color: #00e676; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: bold;">${data.score}/100</span></div>` : ''}
          </div>
          ${data.reason ? `<p style="font-size: 13px; line-height: 1.6; color: #7a9bb5;">${data.reason}</p>` : ''}
        </div>
      </div>`,
  }),
  daily: (data) => ({
    subject: `📈 Resumen Diario — ${data.date || new Date().toLocaleDateString('es-ES')}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #0a0e1a; color: #e8f4f8; border-radius: 16px; overflow: hidden; border: 1px solid rgba(0,212,255,0.15);">
        <div style="background: linear-gradient(135deg, #00d4ff, #0099cc); padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; color: #000;">♔ CHESS INVEST</h1>
          <p style="margin: 4px 0 0; font-size: 12px; color: rgba(0,0,0,0.7);">Resumen Diario</p>
        </div>
        <div style="padding: 24px;">
          ${data.summary || '<p style="font-size: 13px; color: #7a9bb5;">Tu resumen diario de mercados está listo.</p>'}
          <a href="${process.env.APP_URL || 'https://chessinvest.onrender.com'}" style="display: block; text-align: center; padding: 12px; margin-top: 16px; background: #00d4ff; color: #000; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;">Abrir Chess Invest</a>
        </div>
      </div>`,
  }),
};

function buildEmail(type, data) {
  const template = TEMPLATES[type];
  if (!template) {
    return { subject: `CHESS INVEST — ${type}`, html: `<div style="font-family: Arial, sans-serif; padding: 20px; background: #0a0e1a; color: #e8f4f8;"><h2>${data?.title || type}</h2><p>${data?.body || ''}</p></div>` };
  }
  return template(data || {});
}

async function sendEmail(to, type, data = {}) {
  const t = getTransporter();
  if (!t) {
    logger.warn('SMTP not configured — email not sent');
    return false;
  }

  const { subject, html } = buildEmail(type, data);

  try {
    await t.sendMail({
      from: config.from,
      to,
      subject,
      html,
    });
    logger.info(`Email sent: ${type} → ${to}`);
    return true;
  } catch (err) {
    logger.warn(`Email failed: ${type} → ${to}: ${err.message}`);
    return false;
  }
}

async function sendNotificationEmail(userId, type, title, body, data = null) {
  try {
    const user = get('SELECT email, username FROM users WHERE id = ?', [userId]);
    if (!user || !user.email) return false;

    const prefs = get('SELECT notifications_email FROM user_settings WHERE user_id = ?', [userId]);
    if (prefs && !prefs.notifications_email) return false;

    return await sendEmail(user.email, type, { ...data, title, body, username: user.username });
  } catch (err) {
    logger.warn(`Failed to send notification email to user ${userId}: ${err.message}`);
    return false;
  }
}

module.exports = { sendEmail, sendNotificationEmail, isConfigured, TEMPLATES };
