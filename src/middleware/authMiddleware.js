// src/middleware/authMiddleware.js
import jwt from 'jsonwebtoken';

// Create auth middleware with storage dependency
export const createAuthMiddleware = (storage) => {
    
    // ==================== HELPER: CHECK BUSINESS STATUS ====================
    const checkBusinessStatus = async (businessId) => {
        if (!businessId) {
            return { 
                isActive: true, 
                message: 'No business associated' 
            };
        }

        try {
            const business = await storage.getBusiness(businessId);
            
            if (!business) {
                return { 
                    isActive: false, 
                    message: 'Business not found' 
                };
            }

            const businessStatus = business.status ? business.status.toLowerCase() : 'active';
            const isActive = !['inactive', 'disabled', 'suspended'].includes(businessStatus);
            
            return {
                isActive,
                businessStatus,
                businessName: business.businessName,
                business
            };
        } catch (error) {
            console.error('Error checking business status:', error);
            return { 
                isActive: false, 
                message: 'Error checking business status' 
            };
        }
    };

    // ==================== AUTHENTICATE TOKEN ====================
    const authenticateToken = async (req, res, next) => {
        try {
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

            if (!token) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Access token required' 
                });
            }

            // Verify JWT token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Attach user data to request
            req.user = decoded;
            next();
            
        } catch (error) {
            console.error('JWT verification error:', error.message);
            
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Token expired. Please login again.' 
                });
            }
            
            if (error.name === 'JsonWebTokenError') {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Invalid token' 
                });
            }

            return res.status(500).json({ 
                success: false, 
                message: 'Authentication failed' 
            });
        }
    };

    // ==================== REQUIRE ACTIVE BUSINESS ====================
    const requireActiveBusiness = async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Authentication required' 
                });
            }

            // Get business ID from token payload
            const businessId = req.user.businessUUID || req.user.businessId || req.user.associatedBusinessId;
            
            if (!businessId) {
                // Users without business association (e.g., super admin) can proceed
                console.log("⚠️ User has no business association, skipping business check");
                return next();
            }

            // Check business status
            const businessStatusCheck = await checkBusinessStatus(businessId);
            
            if (!businessStatusCheck.isActive) {
                return res.status(403).json({
                    success: false,
                    message: `Your business "${businessStatusCheck.businessName || 'account'}" has been ${businessStatusCheck.businessStatus}. Please contact your administrator.`,
                    businessStatus: businessStatusCheck.businessStatus,
                    code: "BUSINESS_DISABLED"
                });
            }

            // Attach business info to request for use in routes
            req.business = businessStatusCheck.business;
            next();
        } catch (error) {
            console.error('Business status check error:', error);
            return res.status(500).json({
                success: false,
                message: 'Error checking business status'
            });
        }
    };

    // ==================== AUTHORIZE ROLES ====================
    const authorize = (allowedRoles) => {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Authentication required' 
                });
            }

            const userRole = req.user.role;
            
            if (!allowedRoles.includes(userRole)) {
                console.log(`🚫 Access denied for role: ${userRole}. Required: ${allowedRoles}`);
                return res.status(403).json({ 
                    success: false, 
                    message: 'Insufficient permissions' 
                });
            }

            console.log(`✅ Access granted for role: ${userRole}`);
            next();
        };
    };

    // ==================== CREATE BUSINESS CHECK (Special for admin) ====================
    const allowBusinessCreation = async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Authentication required' 
                });
            }

            // Check if user is admin
            const adminRoles = ['super-admin', 'super_admin', 'Super_Admin', 'Biztrack_ADMIN', 'admin'];
            const isAdmin = adminRoles.includes(req.user.role?.toLowerCase());
            
            if (!isAdmin) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: Only administrators can create businesses.'
                });
            }

            // For admin users, skip business status check for create-business route
            // Admin might have a disabled business but can still create new ones
            if (req.method === 'POST' && req.path.includes('/create-business')) {
                console.log("✅ Admin creating new business, skipping business status check");
                return next();
            }

            // For other routes, apply normal business check
            await requireActiveBusiness(req, res, next);
        } catch (error) {
            console.error('Business creation check error:', error);
            return res.status(500).json({
                success: false,
                message: 'Error checking business creation permissions'
            });
        }
    };

    // ==================== BUSINESS OWNER CHECK ====================
    const requireBusinessOwner = async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Authentication required' 
                });
            }

            // Get business ID from params or body
            const businessIdFromParams = req.params.id || req.params.businessId;
            const businessIdFromBody = req.body.businessId || req.body.businessUUID;
            const targetBusinessId = businessIdFromParams || businessIdFromBody;

            if (!targetBusinessId) {
                return res.status(400).json({
                    success: false,
                    message: 'Business ID is required'
                });
            }

            // Check if user is admin
            const adminRoles = ['super-admin', 'super_admin', 'Super_Admin', 'Biztrack_ADMIN', 'admin'];
            const isAdmin = adminRoles.includes(req.user.role?.toLowerCase());
            
            // Check if user owns this business
            const userBusinessId = req.user.businessUUID || req.user.businessId || req.user.associatedBusinessId;
            const isBusinessOwner = userBusinessId === targetBusinessId;

            if (!isAdmin && !isBusinessOwner) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: You do not have permission to access this business.'
                });
            }

            // Check business status if user owns it (admin can access regardless)
            if (isBusinessOwner) {
                const businessStatusCheck = await checkBusinessStatus(targetBusinessId);
                
                if (!businessStatusCheck.isActive) {
                    return res.status(403).json({
                        success: false,
                        message: `Your business "${businessStatusCheck.businessName || 'account'}" has been ${businessStatusCheck.businessStatus}. Please contact your administrator.`,
                        businessStatus: businessStatusCheck.businessStatus,
                        code: "BUSINESS_DISABLED"
                    });
                }

                req.business = businessStatusCheck.business;
            }

            next();
        } catch (error) {
            console.error('Business owner check error:', error);
            return res.status(500).json({
                success: false,
                message: 'Error checking business ownership'
            });
        }
    };

    // ==================== PUBLIC BUSINESS STATUS CHECK ====================
    const checkPublicBusinessStatus = async (req, res, next) => {
        try {
            const businessId = req.params.id || req.params.businessId || req.query.businessId;
            
            if (!businessId) {
                return res.status(400).json({
                    success: false,
                    message: 'Business ID is required'
                });
            }

            const businessStatusCheck = await checkBusinessStatus(businessId);
            
            // Attach to request for use in route
            req.businessStatus = businessStatusCheck;
            next();
        } catch (error) {
            console.error('Public business status check error:', error);
            return res.status(500).json({
                success: false,
                message: 'Error checking business status'
            });
        }
    };

    return {
        authenticateToken,
        authorize,
        requireActiveBusiness,
        allowBusinessCreation,
        requireBusinessOwner,
        checkPublicBusinessStatus,
        checkBusinessStatus // Export helper function if needed elsewhere
    };
};

// Legacy export for backward compatibility
export const authenticateToken = (req, res, next) => {
    // This is now a factory function, so we need to use createAuthMiddleware
    console.warn('⚠️ Direct use of authenticateToken is deprecated. Use createAuthMiddleware instead.');
    
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Access token required' 
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('JWT verification error:', error.message);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Token expired. Please login again.' 
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid token' 
            });
        }

        return res.status(500).json({ 
            success: false, 
            message: 'Authentication failed' 
        });
    }
};

// Legacy export for backward compatibility
export const authorize = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
        }

        const userRole = req.user.role;
        
        if (!allowedRoles.includes(userRole)) {
            console.log(`🚫 Access denied for role: ${userRole}. Required: ${allowedRoles}`);
            return res.status(403).json({ 
                success: false, 
                message: 'Insufficient permissions' 
            });
        }

        console.log(`✅ Access granted for role: ${userRole}`);
        next();
    };
};