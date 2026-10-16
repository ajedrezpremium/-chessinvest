const { Router } = require('express');
const { getSupabaseAdmin } = require('../services/supabase');
const logger = require('../services/logger');

const router = Router();

const CATEGORIES = ['herramienta', 'regulador', 'organismo', 'formacion'];

// Directorio público (lectura). Sin auth: contenido editorial + SEO.
router.get('/', async (req, res) => {
  try {
    const admin = getSupabaseAdmin();
    let query = admin.from('resources').select('*').order('featured', { ascending: false }).order('name');
    if (req.query.category && CATEGORIES.includes(req.query.category)) {
      query = query.eq('category', req.query.category);
    }
    if (req.query.q) {
      const q = `%${String(req.query.q).slice(0, 60)}%`;
      query = query.or(`name.ilike.${q},description.ilike.${q}`);
    }
    const { data, error } = await query.limit(200);
    if (error) throw error;
    res.json({ count: (data || []).length, categories: CATEGORIES, resources: data || [] });
  } catch (err) {
    logger.error(`Resources error: ${err.message}`);
    res.status(500).json({ error: 'Directorio no disponible ahora mismo' });
  }
});

module.exports = router;
