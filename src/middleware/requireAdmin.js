// ============================================================================
// SoTaNik_AI Data Lake — Super-Admin Authorization Middleware
// Only sagnik.saha.raptor@gmail.com has super-admin rights to manage tenants,
// perform complete user + cloud deletions, and allocate public storage nodes.
// ============================================================================

const SUPER_ADMIN_EMAIL = 'sagnik.saha.raptor@gmail.com';

module.exports = function requireAdmin(req, res, next) {
  if (!req.userEmail || req.userEmail.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).json({
      error: 'Access denied. This endpoint requires Super-Admin authorization.',
    });
  }
  req.isAdmin = true;
  next();
};
