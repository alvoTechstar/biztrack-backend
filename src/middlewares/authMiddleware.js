// src/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const { storage } = require('../utils/storage.js');
const { isBlacklisted } = require('../utils/tokenBlacklist.js');

// Create auth middleware with storage dependency
const createAuthMiddleware = (storage) => {

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

            if (isBlacklisted(token)) {
                return res.status(401).json({
                    success: false,
                    message: 'Session expired. Please login again.',
                    code: 'TOKEN_REVOKED'
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

            // Platform admins manage all businesses — never block them based on
            // the status of whichever business their own account happens to be linked to.
            const adminRoles = ['super-admin', 'super_admin', 'Super_Admin', 'Biztrack_ADMIN', 'admin'];
            if (adminRoles.includes(req.user.role)) {
                return next();
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

            // Get business ID from params
            const businessIdFromParams = req.params.id;

            if (!businessIdFromParams) {
                return res.status(400).json({
                    success: false,
                    message: 'Business ID is required'
                });
            }

            // Guard: reject obviously-wrong "IDs" that are route names
            const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const isNumericId = /^\d+$/.test(businessIdFromParams);
            const isUUID = UUID_RE.test(businessIdFromParams);
            if (!isNumericId && !isUUID) {
                return res.status(400).json({
                    success: false,
                    message: `'${businessIdFromParams}' is not a valid business ID. Did you mean GET /api/business/get-all?`
                });
            }

            // Fetch full user from database to get all business associations
            const fullUser = await storage.getUser(req.user.id);

            if (!fullUser) {
                return res.status(401).json({
                    success: false,
                    message: 'User not found'
                });
            }

            // Check if user is admin
            const adminRoles = ['super-admin', 'super_admin', 'Super_Admin', 'Biztrack_ADMIN', 'admin'];
            const userRole = fullUser.role?.toLowerCase?.() || fullUser.role;
            const isAdmin = adminRoles.some(role => role.toLowerCase() === userRole?.toLowerCase());

            // Check if user owns this business - check all possible business ID fields
            const userBusinessId = fullUser.businessId ||
                fullUser.businessUUID ||
                fullUser.associatedBusinessId ||
                fullUser.business?.id ||
                fullUser.business?._id;

            console.log('🔍 Business ownership check:', {
                userId: fullUser.id,
                userEmail: fullUser.email,
                userRole: fullUser.role,
                userBusinessId,
                targetBusinessId: businessIdFromParams,
                isAdmin
            });

            // Convert IDs to strings for comparison
            const userBusinessIdStr = userBusinessId?.toString();
            const targetBusinessIdStr = businessIdFromParams.toString();

            // Allow if user is admin OR if they own the business
            if (isAdmin) {
                console.log(`✅ Admin access granted for role: ${fullUser.role}`);

                // Fetch business info for admin
                const business = await storage.getBusiness(targetBusinessIdStr);
                if (business) {
                    req.business = business;
                }

                return next();
            }

            // For non-admin users, check business ownership
            if (!userBusinessIdStr || userBusinessIdStr !== targetBusinessIdStr) {
                console.error('❌ Business ownership mismatch:', {
                    userBusinessId: userBusinessIdStr,
                    targetBusinessId: targetBusinessIdStr,
                    user: fullUser.email
                });

                return res.status(403).json({
                    success: false,
                    message: 'Access denied. You do not own this business.'
                });
            }

            // Check business status for owner
            const businessStatusCheck = await checkBusinessStatus(targetBusinessIdStr);

            if (!businessStatusCheck.isActive) {
                return res.status(403).json({
                    success: false,
                    message: `Your business "${businessStatusCheck.businessName || 'account'}" has been ${businessStatusCheck.businessStatus}. Please contact your administrator.`,
                    businessStatus: businessStatusCheck.businessStatus,
                    code: "BUSINESS_DISABLED"
                });
            }

            req.business = businessStatusCheck.business;

            console.log(`✅ Business ownership verified for user: ${fullUser.email}`);
            next();

        } catch (error) {
            console.error('❌ Business owner check error:', error);
            return res.status(500).json({
                success: false,
                message: 'Error verifying business ownership',
                error: error.message
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

        if (isBlacklisted(token)) {
            return res.status(401).json({
                success: false,
                message: 'Session expired. Please login again.',
                code: 'TOKEN_REVOKED'
            });
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch full user from database to ensure we have all fields
        const fullUser = await storage.getUser(decoded.id);

        if (!fullUser) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        // Attach full user data to request.
        // businessUUID comes from the JWT payload (set at login) because the User
        // table does not store it — fall back to the decoded claim.
        req.user = {
            id: fullUser.id,
            _id: fullUser.id,
            email: fullUser.email,
            role: fullUser.role,
            firstName: fullUser.firstName,
            lastName: fullUser.lastName,
            businessId: decoded.businessId ?? fullUser.businessId,
            businessUUID: decoded.businessUUID ?? fullUser.businessUUID,
            associatedBusinessId: fullUser.associatedBusinessId,
            institutionId: fullUser.institutionId,
            businessName: fullUser.businessName,
            status: fullUser.status
        };

        console.log(`✅ User authenticated: ${fullUser.email} (Role: ${fullUser.role})`);
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

module.exports = {
    createAuthMiddleware,
    authenticateToken,
    authorize
};