const { z } = require('zod');

const AccionSchema = z.object({
  ticker: z.string().min(1).max(10),
  nombre: z.string().min(1),
  mercado: z.string().min(1),
  precio: z.string().min(1),
  variacion: z.string().min(1),
  puntuacion: z.number().min(0).max(100),
  criterios_met: z.number().min(0).max(20),
  razon: z.string().min(1),
  catalizador: z.string().min(1),
  riesgo: z.enum(['bajo', 'medio', 'alto']),
  sector: z.string().min(1),
});

const AlertaSchema = z.object({
  tipo: z.enum(['geopolitico', 'adquisicion', 'producto', 'tecnologia', 'contratacion', 'regulacion']),
  nivel: z.enum(['critical', 'neutral']),
  titulo: z.string().min(1),
  descripcion: z.string().min(1),
  impacto: z.enum(['alto', 'medio']),
  acciones_afectadas: z.array(z.string()).min(1),
  sector: z.string().min(1),
  direccion: z.enum(['positivo', 'negativo']),
});

const AlertasSchema = z.object({
  alertas: z.array(AlertaSchema).min(1).max(10),
});

const RecomendacionesSchema = z.object({
  acciones: z.array(AccionSchema).min(1).max(20),
});

function safeParseRecomendaciones(raw) {
  const result = RecomendacionesSchema.safeParse(raw);
  if (result.success) return { valid: true, data: result.data.acciones };
  return { valid: false, errors: result.error.issues.map(i => i.message) };
}

function safeParseAlertas(raw) {
  const result = AlertasSchema.safeParse(raw);
  if (result.success) return { valid: true, data: result.data.alertas };
  return { valid: false, errors: result.error.issues.map(i => i.message) };
}

module.exports = { safeParseRecomendaciones, safeParseAlertas, RecomendacionesSchema, AlertasSchema };
