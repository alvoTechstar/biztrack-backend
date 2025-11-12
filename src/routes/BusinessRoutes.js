// src/routes/businessRoutes.js

import { Router } from 'express';
import { insertBusinessSchema, updateBusinessSchema } from '../schema.js'; 
import { z } from 'zod';
import multer from 'multer';

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

    // --- Mock Middleware for Demonstration ---

    // 1. Auth Middleware (Placeholder)
    const protect = (req, res, next) => {
        // Mock user attached to request for authorization checks
        req.user = { 
            email: 'test.admin@example.com', 
            id: 'user-123', 
            role: 'Biztrack_ADMIN',
            associatedBusinessId: 'BIZ-TRACK-DEFAULT'
        };
        next();
    };

    // 2. Admin/Super Admin Authorization Middleware (Placeholder)
    const restrictToAdmin = (req, res, next) => {
        if (req.user.role === 'Biztrack_ADMIN') {
            next();
        } else {
            res.status(403).json({ message: 'Forbidden: Insufficient privileges.' });
        }
    };

    // --- Helper Function to Process FormData ---
    const processBusinessData = (body) => {
        // FormData sends all fields as strings, so we need to process them
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

    // --- Route Definitions ---

    /**
     * @route POST /api/businesses
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

            // 1. Zod Validation - Process the form data
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
                status: body.status || 'new', // Default to 'new'
                logoUrl: body.logoUrl,
                owner: body.owner
            });

            console.log("✅ Validated Data:", parsedData);

            // 2. Check for uniqueness
            const existingBusinessByReg = await storage.getBusinessByRegistrationNumber(parsedData.registrationNumber);
            if (existingBusinessByReg) {
                return res.status(400).json({ message: 'A business with this registration number already exists.' });
            }
            
            // 3. Handle Logo Upload Logic
            let logoUrl = parsedData.logoUrl || '';

            if (logoFile) {
                // In a real implementation, you would upload to cloud storage (AWS S3, Google Cloud Storage, etc.)
                // For now, we'll create a mock URL and store the file buffer in the database
                logoUrl = `https://biztrack.com/logos/${parsedData.registrationNumber}-${Date.now()}.${logoFile.mimetype.split('/')[1]}`;
                console.log(`🖼️ Logo Upload: ${logoFile.originalname} -> ${logoUrl}`);
                
                // Store file buffer in database (you might want to store in separate file storage)
                // For demo, we'll just store the URL
            } else if (!logoUrl) {
                // Use default logo if none is uploaded or provided
                logoUrl = 'https://biztrack.com/default_logo.svg'; 
            }
            
            // Prepare data for storage
            const businessData = { 
                ...parsedData, 
                logoUrl,
                // Add any additional fields your storage expects
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            console.log("💾 Saving Business Data:", businessData);

            // 4. Create Business in DB
            const newBusiness = await storage.createBusiness(businessData);

            res.status(201).json({ 
                message: 'Business created successfully.', 
                business: newBusiness 
            });

        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error("❌ Validation Error:", error.errors);
                return res.status(400).json({ 
                    message: 'Validation failed', 
                    errors: error.errors,
                    error: error.message 
                });
            }
            console.error('🚨 Business creation error:', error);
            res.status(500).json({ 
                message: 'Internal server error during business creation.', 
                error: error.message 
            });
        }
    });

    /**
     * @route GET /api/businesses
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
            res.status(200).json(transformedBusinesses);
        } catch (error) {
            console.error('Get businesses error:', error);
            res.status(500).json({ message: 'Internal server error.' });
        }
    });

    /**
     * @route GET /api/businesses/:id
     * @desc Get business by ID (Requires Admin or business owner/associate)
     */
    businessRouter.get('/:id', protect, async (req, res) => {
        try {
            const { id } = req.params;
            const business = await storage.getBusiness(id);

            if (!business) {
                return res.status(404).json({ message: 'Business not found.' });
            }

            // Basic Authorization Check
            if (req.user.role !== 'Biztrack_ADMIN' && req.user.associatedBusinessId !== business.businessId) {
                return res.status(403).json({ message: 'Forbidden: Not authorized to view this business.' });
            }

            // Transform status to uppercase for frontend
            const transformedBusiness = {
                ...business,
                status: business.status?.toUpperCase() || 'NEW'
            };

            res.status(200).json(transformedBusiness);
        } catch (error) {
            console.error('Get business error:', error);
            res.status(500).json({ message: 'Internal server error.' });
        }
    });

    /**
     * @route PATCH /api/businesses/:id
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
                return res.status(404).json({ message: 'Business not found.' });
            }
            
            // 2. Authorization Check
            if (req.user.role !== 'Biztrack_ADMIN' && req.user.associatedBusinessId !== existingBusiness.businessId) {
                return res.status(403).json({ message: 'Forbidden: Not authorized to edit this business.' });
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
                // Upload new logo
                logoUrl = `https://biztrack.com/logos/${existingBusiness.registrationNumber}-${Date.now()}-updated.${logoFile.mimetype.split('/')[1]}`;
                console.log(`🖼️ Logo Update: ${logoFile.originalname} -> ${logoUrl}`);
            } else if (body.logoUrl === '' || body.logoUrl === null) {
                // Allow client to explicitly clear the logo
                logoUrl = '';
            }
            // If no logo file and no explicit clear, keep existing logoUrl
            
            // Prepare final update payload
            const finalUpdatePayload = { 
                ...updateData, 
                logoUrl,
                updatedAt: new Date().toISOString()
            };

            console.log("💾 Updating Business Data:", finalUpdatePayload);

            // 5. Update Business in DB
            const updatedBusiness = await storage.updateBusiness(id, finalUpdatePayload);

            // Transform status for response
            const transformedBusiness = {
                ...updatedBusiness,
                status: updatedBusiness.status?.toUpperCase() || 'NEW'
            };

            res.status(200).json({ 
                message: 'Business updated successfully.', 
                business: transformedBusiness 
            });

        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error("❌ Validation Error:", error.errors);
                return res.status(400).json({ 
                    message: 'Validation failed', 
                    errors: error.errors 
                });
            }
            console.error('🚨 Business update error:', error);
            res.status(500).json({ 
                message: 'Internal server error during business update.',
                error: error.message 
            });
        }
    });

    /**
     * @route PUT /api/businesses/:id/status
     * @desc Toggle business status (Requires Admin)
     */
    businessRouter.put('/:id/status', protect, restrictToAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (!status || !['active', 'inactive', 'new'].includes(status.toLowerCase())) {
                return res.status(400).json({ message: 'Invalid status provided.' });
            }

            const existingBusiness = await storage.getBusiness(id);
            if (!existingBusiness) {
                return res.status(404).json({ message: 'Business not found.' });
            }

            const updatedBusiness = await storage.updateBusiness(id, { 
                status: status.toLowerCase(),
                updatedAt: new Date().toISOString()
            });

            const transformedBusiness = {
                ...updatedBusiness,
                status: updatedBusiness.status?.toUpperCase() || 'NEW'
            };

            res.status(200).json({ 
                message: `Business status updated to ${status}.`,
                business: transformedBusiness
            });

        } catch (error) {
            console.error('Status update error:', error);
            res.status(500).json({ message: 'Internal server error during status update.' });
        }
    });

    /**
     * @route DELETE /api/businesses/:id
     * @desc Delete business (Archives by setting status to 'inactive') (Requires Admin)
     */
    businessRouter.delete('/:id', protect, restrictToAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            
            // Set business status to 'inactive' (archive)
            const archivedBusiness = await storage.updateBusiness(id, { 
                status: 'inactive',
                updatedAt: new Date().toISOString()
            });
            
            if (!archivedBusiness) {
                return res.status(404).json({ message: 'Business not found.' });
            }
            
            // NOTE: In a complete system, you would also deactivate all associated users here.

            res.status(200).json({ 
                message: `Business "${archivedBusiness.businessName}" successfully archived.`,
                business: archivedBusiness
            });
            
        } catch (error) {
            console.error('Business delete/archive error:', error);
            res.status(500).json({ message: 'Internal server error during business deletion.' });
        }
    });

    return businessRouter;
}