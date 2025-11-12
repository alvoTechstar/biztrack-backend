// src/middleware/authMiddleware.js
import jwt from 'jsonwebtoken';

export const authenticateToken = (req, res, next) => {
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