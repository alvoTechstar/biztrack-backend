// src/routes/businessRoutes.js

import { Router } from 'express';
import { insertBusinessSchema, updateBusinessSchema } from '../schema.js'; 
import { z } from 'zod';
import multer from 'multer';
import { authenticateToken, authorize } from '../middleware/authMiddleware.js';

// Initialize storage and router
export default function BusinessRoutes(storage) {
    const businessRouter = Router();

    // --- Multer Configuration for File Upload ---
    const upload = multer({ 
        storage: multer.memoryStorage(),
        limits: {
            fileSize: 2 * 1024 * 1024, // 2MB limit
        },
        fileFilter: (req, file, cb) => {
            // Check if file is an image
            if (file.mimetype.startsWith('image/')) {
                cb(null, true);
            } else {
                cb(new Error('Only image files are allowed!'), false);
            }
        }
    }); 

    // --- JWT Authentication Middleware ---
    const protect = (req, res, next) => {
        try {
            const token = req.header('Authorization')?.replace('Bearer ', '');
            
            if (!token) {
                return res.status(401).json({
                    success: false,
                    message: 'Access denied. No token provided.'
                });
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
            next();
        } catch (error) {
            console.error('JWT verification failed:', error.message);
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }
    };

    // --- Admin Authorization Middleware ---
    const restrictToAdmin = (req, res, next) => {
        if (req.user.role === 'Biztrack_ADMIN' || req.user.role === 'Super_Admin') {
            next();
        } else {
            res.status(403).json({ 
                success: false,
                message: 'Forbidden: Insufficient privileges.' 
            });
        }
    };

    // --- Helper Function to Process FormData ---
    const processBusinessData = (body) => {
        const processedData = { ...body };
        
        // Convert empty strings to null/undefined for optional fields
        const optionalFields = ['website', 'description', 'logoUrl', 'primaryColor'];
        optionalFields.forEach(field => {
            if (processedData[field] === '') {
                processedData[field] = undefined;
            }
        });

        // Ensure status is lowercase for consistency
        if (processedData.status) {
            processedData.status = processedData.status.toLowerCase();
        }

        return processedData;
    };

    // --- Helper Function to Generate Auto-Increment Business ID ---
    const generateNextBusinessId = async () => {
        try {
            const businesses = await storage.getBusinesses();
            
            if (!businesses || businesses.length === 0) {
                return 1; // Start from 1 if no businesses exist
            }
            
            // Find the highest businessId
            const maxBusinessId = businesses.reduce((max, business) => {
                const businessId = business.businessId || 0;
                return businessId > max ? businessId : max;
            }, 0);
            
            return maxBusinessId + 1;
        } catch (error) {
            console.error('Error generating business ID:', error);
            // Fallback: use timestamp if there's an error
            return Date.now();
        }
    };

    // --- Route Definitions ---

    /**
     * @route POST /api/business
     * @desc Create a new business (Requires Admin). Handles logo upload.
     */
    businessRouter.post('/', 
        protect, 
        restrictToAdmin, 
        upload.single('logo'), 
        async (req, res) => {
        try {
            const logoFile = req.file;
            const body = processBusinessData(req.body);
            
            console.log("📨 Received Request Body:", body);
            console.log("📁 Received File:", logoFile ? {
                originalname: logoFile.originalname,
                mimetype: logoFile.mimetype,
                size: logoFile.size
            } : 'No file');

            // 1. Generate auto-increment business ID
            const nextBusinessId = await generateNextBusinessId();
            console.log("🔢 Generated Business ID:", nextBusinessId);

            // 2. Zod Validation
            const parsedData = insertBusinessSchema.parse({
                businessName: body.businessName,
                registrationNumber: body.registrationNumber,
                address: body.address,
                businessType: body.businessType,
                email: body.email,
                phone: body.phone,
                website: body.website,
                description: body.description,
                primaryColor: body.primaryColor,
                status: body.status || 'new',
                logoUrl: body.logoUrl,
                owner: body.owner
            });

            console.log("✅ Validated Data:", parsedData);

            // 3. Check for uniqueness
            const existingBusinessByReg = await storage.getBusinessByRegistrationNumber(parsedData.registrationNumber);
            if (existingBusinessByReg) {
                return res.status(400).json({ 
                    success: false,
                    message: 'A business with this registration number already exists.' 
                });
            }
            
            // 4. Handle Logo Upload Logic
            let logoUrl = parsedData.logoUrl || '';

            if (logoFile) {
                // In a real application, you would upload logoFile.buffer to S3/Cloud Storage here.
                // For demonstration, we construct a placeholder URL.
                logoUrl = `https://biztrack.com/logos/${parsedData.registrationNumber}-${Date.now()}.${logoFile.mimetype.split('/')[1]}`;
                console.log(`🖼️ Logo Upload: ${logoFile.originalname} -> ${logoUrl}`);
            } else if (!logoUrl) {
                logoUrl = 'https://biztrack.com/default_logo.svg'; 
            }
            
            // Prepare data for storage with auto-generated businessId
            const businessData = { 
                ...parsedData, 
                businessId: nextBusinessId, // Add the auto-generated ID
                logoUrl,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            console.log("💾 Saving Business Data with ID:", businessData.businessId);

            // 5. Create Business in DB
            const newBusiness = await storage.createBusiness(businessData);

            res.status(201).json({ 
                success: true,
                message: 'Business created successfully.', 
                business: newBusiness 
            });

        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error("❌ Validation Error:", error.errors);
                return res.status(400).json({ 
                    success: false,
                    message: 'Validation failed', 
                    errors: error.errors
                });
            }
            // Add check for Multer file filter error
            if (error.message === 'Only image files are allowed!') {
                return res.status(400).json({
                    success: false,
                    message: error.message
                });
            }
            console.error('🚨 Business creation error:', error);
            res.status(500).json({ 
                success: false,
                message: 'Internal server error during business creation.', 
                error: error.message 
            });
        }
    });

    /**
     * @route GET /api/business
     * @desc Get all businesses (Requires Admin)
     */
    businessRouter.get('/', protect, restrictToAdmin, async (req, res) => {
        try {
            const businesses = await storage.getBusinesses();
            // Transform data to match frontend expectations
            const transformedBusinesses = businesses.map(business => ({
                ...business,
                status: business.status?.toUpperCase() || 'NEW'
            }));
            
            res.status(200).json({
                success: true,
                data: transformedBusinesses
            });
        } catch (error) {
            console.error('Get businesses error:', error);
            res.status(500).json({ 
                success: false,
                message: 'Internal server error.' 
            });
        }
    });

    /**
     * @route GET /api/business/:id
     * @desc Get business by ID (Requires Admin or business owner/associate)
     */
    businessRouter.get('/:id', protect, async (req, res) => {
        try {
            const { id } = req.params;
            const business = await storage.getBusiness(id);

            if (!business) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Business not found.' 
                });
            }

            // Authorization Check
            if (req.user.role !== 'Biztrack_ADMIN' && req.user.role !== 'Super_Admin' && req.user.associatedBusinessId !== business.businessId) {
                return res.status(403).json({ 
                    success: false,
                    message: 'Forbidden: Not authorized to view this business.' 
                });
            }

            // Transform status to uppercase for frontend
            const transformedBusiness = {
                ...business,
                status: business.status?.toUpperCase() || 'NEW'
            };

            res.status(200).json({
                success: true,
                data: transformedBusiness
            });
        } catch (error) {
            console.error('Get business error:', error);
            res.status(500).json({ 
                success: false,
                message: 'Internal server error.' 
            });
        }
    });

    /**
     * @route PATCH /api/business/:id
     * @desc Update business details (Requires Admin or business owner/associate). Handles logo update.
     */
    businessRouter.patch('/:id', protect, upload.single('logo'), async (req, res) => {
        try {
            const { id } = req.params;
            const logoFile = req.file;
            const body = processBusinessData(req.body);
            
            console.log("📨 Update Request Body:", body);
            console.log("📁 Update File:", logoFile ? {
                originalname: logoFile.originalname,
                mimetype: logoFile.mimetype,
                size: logoFile.size
            } : 'No file');

            // 1. Fetch existing business
            const existingBusiness = await storage.getBusiness(id);
            if (!existingBusiness) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Business not found.' 
                });
            }
            
            // 2. Authorization Check
            if (req.user.role !== 'Biztrack_ADMIN' && req.user.role !== 'Super_Admin' && req.user.associatedBusinessId !== existingBusiness.businessId) {
                return res.status(403).json({ 
                    success: false,
                    message: 'Forbidden: Not authorized to edit this business.' 
                });
            }
            
            // 3. Zod Validation (partial update)
            const updateData = updateBusinessSchema.parse({
                businessName: body.businessName,
                registrationNumber: body.registrationNumber,
                address: body.address,
                businessType: body.businessType,
                email: body.email,
                phone: body.phone,
                website: body.website,
                description: body.description,
                primaryColor: body.primaryColor,
                status: body.status,
                logoUrl: body.logoUrl,
                owner: body.owner
            });

            console.log("✅ Validated Update Data:", updateData);

            // 4. Handle Logo Update
            let logoUrl = existingBusiness.logoUrl; 

            if (logoFile) {
                // In a real application, you would upload logoFile.buffer to S3/Cloud Storage here.
                logoUrl = `https://biztrack.com/logos/${existingBusiness.registrationNumber}-${Date.now()}-updated.${logoFile.mimetype.split('/')[1]}`;
                console.log(`🖼️ Logo Update: ${logoFile.originalname} -> ${logoUrl}`);
            } else if (body.logoUrl === '' || body.logoUrl === null) {
                // If the frontend explicitly sends logoUrl as empty string (e.g., user cleared it)
                logoUrl = '';
            }
            
            // Prepare final update payload (preserve existing businessId)
            const finalUpdatePayload = { 
                ...updateData, 
                logoUrl,
                updatedAt: new Date().toISOString()
            };

            console.log("💾 Updating Business Data:", finalUpdatePayload);

            // 5. Update Business in DB
            const updatedBusiness = await storage.updateBusiness(id, finalUpdatePayload);

            if (!updatedBusiness) {
                 return res.status(404).json({ 
                    success: false,
                    message: 'Business not found after update attempt.' 
                });
            }
            
            // Transform status for response
            const transformedBusiness = {
                ...updatedBusiness,
                status: updatedBusiness.status?.toUpperCase() || 'NEW'
            };

            res.status(200).json({ 
                success: true,
                message: 'Business updated successfully.', 
                data: transformedBusiness 
            });

        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error("❌ Validation Error:", error.errors);
                return res.status(400).json({ 
                    success: false,
                    message: 'Validation failed', 
                    errors: error.errors 
                });
            }
            // Add check for Multer file filter error
            if (error.message === 'Only image files are allowed!') {
                return res.status(400).json({
                    success: false,
                    message: error.message
                });
            }
            console.error('🚨 Business update error:', error);
            res.status(500).json({ 
                success: false,
                message: 'Internal server error during business update.',
                error: error.message 
            });
        }
    });

    /**
     * @route PUT /api/business/:id/status
     * @desc Toggle business status (Requires Admin)
     */
    businessRouter.put('/:id/status', protect, restrictToAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (!status || !['active', 'inactive', 'new'].includes(status.toLowerCase())) {
                return res.status(400).json({ 
                    success: false,
                    message: 'Invalid status provided. Must be active, inactive, or new.' 
                });
            }

            const existingBusiness = await storage.getBusiness(id);
            if (!existingBusiness) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Business not found.' 
                });
            }

            const updatedBusiness = await storage.updateBusiness(id, { 
                status: status.toLowerCase(),
                updatedAt: new Date().toISOString()
            });
            
            if (!updatedBusiness) {
                 return res.status(404).json({ 
                    success: false,
                    message: 'Business not found after status update attempt.' 
                });
            }

            const transformedBusiness = {
                ...updatedBusiness,
                status: updatedBusiness.status?.toUpperCase() || 'NEW'
            };

            res.status(200).json({ 
                success: true,
                message: `Business status updated to ${status.toUpperCase()}.`,
                data: transformedBusiness
            });

        } catch (error) {
            console.error('Status update error:', error);
            res.status(500).json({ 
                success: false,
                message: 'Internal server error during status update.' 
            });
        }
    });

    /**
     * @route DELETE /api/business/:id
     * @desc Delete business (Archives by setting status to 'inactive') (Requires Admin)
     */
    businessRouter.delete('/:id', protect, restrictToAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            
            const existingBusiness = await storage.getBusiness(id);
            if (!existingBusiness) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Business not found.' 
                });
            }

            // Set business status to 'inactive' (archive)
            const archivedBusiness = await storage.updateBusiness(id, { 
                status: 'inactive',
                updatedAt: new Date().toISOString()
            });
            
            if (!archivedBusiness) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Business not found after archive attempt.' 
                });
            }

            res.status(200).json({ 
                success: true,
                message: `Business "${archivedBusiness.businessName}" (ID: ${archivedBusiness.businessId}) successfully archived.`,
                data: archivedBusiness
            });
            
        } catch (error) {
            console.error('Business delete/archive error:', error);
            res.status(500).json({ 
                success: false,
                message: 'Internal server error during business deletion.' 
            });
        }
    });

    return businessRouter;
}