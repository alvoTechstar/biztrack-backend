// src/routes/BusinessRoutes.js
import express from 'express';
import { insertBusinessSchema, updateBusinessSchema } from '../schema.js';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createAuthMiddleware } from '../middleware/authMiddleware.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function BusinessRoutes(storage) {
    const router = express.Router();

    // Create auth middleware with storage dependency
    const authMiddleware = createAuthMiddleware(storage);
    const { 
        authenticateToken, 
        requireActiveBusiness, 
        allowBusinessCreation,
        requireBusinessOwner,
        authorize 
    } = authMiddleware;

    // Admin roles configuration
    const adminRoles = ['super-admin', 'super_admin', 'Super_Admin', 'Biztrack_ADMIN', 'admin'];

    // Ensure logos directory exists - inside src/assets/logos
    const logosDir = path.join(__dirname, '..', 'assets', 'logos');
    
    try {
        if (!fs.existsSync(logosDir)) {
            fs.mkdirSync(logosDir, { recursive: true });
            console.log(`✅ Created logos directory: ${logosDir}`);
        }
    } catch (err) {
        console.error('❌ Error creating logos directory:', err.message);
    }

    // --- Helper: Get Full Logo URL ---
    const getFullLogoUrl = (logoPath) => {
        if (!logoPath) {
            // Return default logo as full URL
            return `http://localhost:3000/assets/logos/default_logo.svg`;
        }
        
        // If it's already a full URL, return as-is
        if (logoPath.startsWith('http://') || logoPath.startsWith('https://')) {
            return logoPath;
        }
        
        // If it's a relative path, make it a full URL
        if (logoPath.startsWith('/')) {
            return `http://localhost:3000${logoPath}`;
        }
        
        // If it's just a filename, prepend the path
        return `http://localhost:3000/assets/logos/${logoPath}`;
    };

    // --- Helper: Get Relative Logo Path (for storage) ---
    const getRelativeLogoPath = (logoPath) => {
        if (!logoPath) {
            return '/assets/logos/default_logo.svg';
        }
        
        // If it's already a relative path, return as-is
        if (logoPath.startsWith('/assets/logos/')) {
            return logoPath;
        }
        
        // If it's a full URL, extract the relative part
        if (logoPath.startsWith('http://localhost:3000/assets/logos/')) {
            return logoPath.replace('http://localhost:3000', '');
        }
        
        // If it's a filename, make it a relative path
        if (logoPath.includes('.')) {
            return `/assets/logos/${logoPath}`;
        }
        
        return '/assets/logos/default_logo.svg';
    };

    // --- Multer Configuration for File Upload (Disk Storage) ---
    const storageConfig = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, logosDir);
        },
        filename: (req, file, cb) => {
            // Generate unique filename: timestamp + random string + original extension
            const timestamp = Date.now();
            const randomStr = Math.random().toString(36).substring(2, 8);
            const ext = path.extname(file.originalname).toLowerCase();
            const filename = `logo_${timestamp}_${randomStr}${ext}`;
            cb(null, filename);
        }
    });

    const upload = multer({
        storage: storageConfig,
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

    // --- Helper Function: Delete Old Logo File ---
    const deleteLogoFile = (logoPath) => {
        try {
            const relativePath = getRelativeLogoPath(logoPath);
            
            if (relativePath && relativePath !== '/assets/logos/default_logo.svg') {
                const filename = path.basename(relativePath);
                const filePath = path.join(logosDir, filename);
                
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`🗑️ Deleted old logo file: ${filename}`);
                }
            }
        } catch (error) {
            console.error('❌ Error deleting logo file:', error.message);
            // Don't fail the request if logo deletion fails
        }
    };

    // --- Helper Function: Transform Business Response ---
    const transformBusinessResponse = (business) => {
        if (!business) return null;
        
        const businessObj = business?.toObject ? business.toObject() : business;
        
        return {
            ...businessObj,
            status: businessObj?.status?.toUpperCase() || 'ACTIVE',
            // Return full URL for logo in API responses
            logoUrl: getFullLogoUrl(businessObj.logoUrl),
            // Also include as 'logo' for compatibility with login response
            logo: getFullLogoUrl(businessObj.logoUrl)
        };
    };

    // --- Helper Function to Process FormData ---
    const processBusinessData = (body) => {
        const processedData = { ...body };

        // Convert empty strings to null/undefined for optional fields
        const optionalFields = ['website', 'description', 'primaryColor'];
        optionalFields.forEach(field => {
            if (processedData[field] === '') {
                processedData[field] = undefined;
            }
        });

        // Ensure status is lowercase for consistency
        if (processedData.status) {
            processedData.status = processedData.status.toLowerCase();
        }

        // Convert logoUrl to relative path if it's a full URL
        if (processedData.logoUrl && processedData.logoUrl.startsWith('http')) {
            processedData.logoUrl = getRelativeLogoPath(processedData.logoUrl);
        }

        return processedData;
    };

    // --- SAFE MAP HELPER ---
    const safeMap = (array, callback) => {
        if (!array || !Array.isArray(array)) {
            return [];
        }
        return array.map(callback);
    };

    // --- Route Definitions ---

    /**
     * @route POST /api/business/create-business
     * @desc Create a new business (Requires Admin). Handles logo upload via FormData.
     * NOTE: Uses allowBusinessCreation middleware which skips business status check for admin
     */
    router.post('/create-business',
        authenticateToken,
        allowBusinessCreation,
        upload.single('logo'),
        async (req, res) => {
            try {
                const logoFile = req.file;
                const body = processBusinessData(req.body);

                console.log("📨 POST Request - Received Request Body:", body);
                console.log("📁 POST Request - Received File:", logoFile ? {
                    originalname: logoFile.originalname,
                    mimetype: logoFile.mimetype,
                    size: logoFile.size,
                    filename: logoFile.filename
                } : 'No file');

                // 1. Zod Validation
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
                    status: body.status || 'active',
                    logoUrl: undefined, // Will be set after validation
                    owner: body.owner
                });

                console.log("✅ Validated Data:", parsedData);

                // 2. Check for uniqueness
                const existingBusinessByReg = await storage.getBusinessByRegistrationNumber(parsedData.registrationNumber);
                if (existingBusinessByReg) {
                    return res.status(400).json({
                        success: false,
                        message: 'A business with this registration number already exists.'
                    });
                }

                // 3. Handle Logo Upload Logic
                let logoUrl = '/assets/logos/default_logo.svg'; // Default relative path

                if (logoFile) {
                    // If a file is uploaded, use relative path
                    logoUrl = `/assets/logos/${logoFile.filename}`;
                    console.log(`🖼️ Logo Upload: ${logoFile.originalname} -> ${logoUrl}`);
                } else if ('logoUrl' in body) {
                    // If logoUrl field exists in the request
                    if (body.logoUrl === '') {
                        // Empty string means use default
                        console.log(`🖼️ Empty logoUrl provided, using default: ${logoUrl}`);
                    } else if (body.logoUrl) {
                        // Non-empty string, use the provided URL (already converted to relative)
                        logoUrl = body.logoUrl;
                        console.log(`🖼️ Logo URL provided (converted to relative): ${logoUrl}`);
                    }
                } else {
                    // If logoUrl is NOT in the request at all, use default logo
                    console.log(`🖼️ No logo field in request, using default: ${logoUrl}`);
                }

                // Prepare data for storage
                const businessData = {
                    ...parsedData,
                    logoUrl, // Store relative path in database
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                console.log("💾 Saving Business Data");
                console.log("💾 Business data logo (relative):", businessData.logoUrl);

                // 4. Create Business in DB (storage will auto-generate businessId)
                const newBusiness = await storage.createBusiness(businessData);

                // Transform response with full URL
                const transformedBusiness = transformBusinessResponse(newBusiness);

                res.status(201).json({
                    success: true,
                    message: 'Business created successfully.',
                    business: transformedBusiness
                });

            } catch (error) {
                if (error instanceof z.ZodError) {
                    console.error("❌ Validation Error:", error.errors);
                    // SAFE FIX: Use safeMap to handle errors
                    const validationErrors = safeMap(error.errors || [], err => ({
                        field: err.path ? err.path.join('.') : 'unknown',
                        message: err.message || 'Validation error'
                    }));
                    
                    return res.status(400).json({
                        success: false,
                        message: 'Validation failed',
                        errors: validationErrors
                    });
                }
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
     * @desc Get all businesses (Requires Admin + Active Business)
     */
    router.get('/', 
        authenticateToken, 
        requireActiveBusiness, 
        authorize(adminRoles),
        async (req, res) => {
            try {
                console.log("📋 GET /api/business - Fetching all businesses");
                const businesses = await storage.getBusinesses();
                
                // SAFE FIX: Ensure businesses is an array before mapping
                const businessesArray = Array.isArray(businesses) ? businesses : [];
                
                // Transform data to match frontend expectations with full URLs
                const transformedBusinesses = safeMap(businessesArray, business => 
                    transformBusinessResponse(business)
                );

                console.log(`✅ Found ${transformedBusinesses.length} businesses`);

                res.status(200).json({
                    success: true,
                    data: transformedBusinesses
                });
            } catch (error) {
                console.error('❌ Get businesses error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Internal server error.'
                });
            }
        }
    );

    /**
     * @route GET /api/business/:id
     * @desc Get business by ID (Requires Admin or business owner/associate + Active Business)
     */
    router.get('/:id', 
        authenticateToken, 
        requireBusinessOwner,
        async (req, res) => {
            try {
                const { id } = req.params;
                console.log("📋 GET /api/business/:id - Fetching business:", id);
                
                const business = await storage.getBusiness(id);

                if (!business) {
                    return res.status(404).json({
                        success: false,
                        message: 'Business not found.'
                    });
                }

                // Transform response with full URL
                const transformedBusiness = transformBusinessResponse(business);

                res.status(200).json({
                    success: true,
                    data: transformedBusiness
                });
            } catch (error) {
                console.error('❌ Get business error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Internal server error.'
                });
            }
        }
    );

    /**
     * @route PUT /api/business/:id
     * @desc Update business details (Requires Admin or business owner/associate + Active Business). Handles logo update via FormData.
     */
    router.put('/:id', 
        authenticateToken, 
        requireBusinessOwner,
        upload.single('logo'), 
        async (req, res) => {
            try {
                const { id } = req.params;
                const logoFile = req.file;
                const body = processBusinessData(req.body);

                console.log("📨 PUT Request - Update Request Body:", body);
                console.log("📁 PUT Request - Update File:", logoFile ? {
                    originalname: logoFile.originalname,
                    mimetype: logoFile.mimetype,
                    size: logoFile.size,
                    filename: logoFile.filename
                } : 'No file');

                // 1. Fetch existing business
                const existingBusiness = await storage.getBusiness(id);
                if (!existingBusiness) {
                    return res.status(404).json({
                        success: false,
                        message: 'Business not found.'
                    });
                }

                const existingBusinessObj = existingBusiness.toObject ? existingBusiness.toObject() : existingBusiness;

                // 2. Authorization is already handled by requireBusinessOwner middleware

                // 3. Prepare update data from request body
                const updateData = {};

                // Only update fields that are present in the request
                const fieldsToUpdate = [
                    'businessName', 'registrationNumber', 'address', 'businessType',
                    'email', 'phone', 'website', 'description', 'primaryColor',
                    'status', 'logoUrl', 'owner'
                ];

                fieldsToUpdate.forEach(field => {
                    if (field in body && body[field] !== undefined) {
                        updateData[field] = body[field];
                    }
                });

                // 4. Handle Logo Update
                let logoUrl = existingBusinessObj.logoUrl; // Start with existing

                if (logoFile) {
                    // If a file is uploaded, delete old logo (if not default) and use new one
                    if (logoUrl && logoUrl !== '/assets/logos/default_logo.svg') {
                        deleteLogoFile(logoUrl);
                    }
                    
                    // Use relative path for new logo
                    logoUrl = `/assets/logos/${logoFile.filename}`;
                    console.log(`🖼️ Logo Update (file): New logo saved to ${logoUrl}`);
                } else if ('logoUrl' in body) {
                    // If logoUrl is explicitly provided in the request body
                    if (body.logoUrl === '') {
                        // Empty string means "clear logo, use default"
                        if (logoUrl && logoUrl !== '/assets/logos/default_logo.svg') {
                            deleteLogoFile(logoUrl);
                        }
                        logoUrl = '/assets/logos/default_logo.svg';
                        console.log(`🖼️ Logo cleared, using default: ${logoUrl}`);
                    } else if (body.logoUrl && body.logoUrl !== logoUrl) {
                        // New URL provided, delete old logo (if not default)
                        if (logoUrl && logoUrl !== '/assets/logos/default_logo.svg') {
                            deleteLogoFile(logoUrl);
                        }
                        logoUrl = body.logoUrl; // Already converted to relative path
                        console.log(`🖼️ Logo Update (URL): ${existingBusinessObj.logoUrl} -> ${logoUrl}`);
                    }
                }

                // Add logoUrl to updateData
                updateData.logoUrl = logoUrl;

                // 5. Zod Validation (partial update)
                const validatedData = updateBusinessSchema.parse(updateData);
                console.log("✅ Validated PUT Update Data:", validatedData);

                // 6. Check for registration number uniqueness (if being updated)
                if (validatedData.registrationNumber && 
                    validatedData.registrationNumber !== existingBusinessObj.registrationNumber) {
                    const existingBusinessByReg = await storage.getBusinessByRegistrationNumber(validatedData.registrationNumber);
                    if (existingBusinessByReg && existingBusinessByReg.id !== existingBusinessObj.id) {
                        return res.status(400).json({
                            success: false,
                            message: 'A business with this registration number already exists.'
                        });
                    }
                }

                // Prepare final update payload
                const finalUpdatePayload = {
                    ...validatedData,
                    updatedAt: new Date().toISOString()
                };

                console.log("💾 PUT Updating Business Data (relative logo):", finalUpdatePayload.logoUrl);

                // 7. Update Business in DB
                const updatedBusiness = await storage.updateBusiness(id, finalUpdatePayload);

                if (!updatedBusiness) {
                    return res.status(404).json({
                        success: false,
                        message: 'Business not found after update attempt.'
                    });
                }

                // Transform response with full URL
                const transformedBusiness = transformBusinessResponse(updatedBusiness);

                res.status(200).json({
                    success: true,
                    message: 'Business updated successfully.',
                    data: transformedBusiness
                });

            } catch (error) {
                // FIXED: Add safe check for error.errors
                if (error instanceof z.ZodError) {
                    console.error("❌ PUT Validation Error:", error);
                    
                    // SAFE FIX: Use safeMap to prevent undefined .map() call
                    const validationErrors = safeMap(error.errors || [], err => ({
                        field: err.path ? err.path.join('.') : 'unknown',
                        message: err.message || 'Validation error'
                    }));
                    
                    return res.status(400).json({
                        success: false,
                        message: 'Validation failed',
                        errors: validationErrors
                    });
                }
                
                if (error.message === 'Only image files are allowed!') {
                    return res.status(400).json({
                        success: false,
                        message: error.message
                    });
                }
                
                console.error('🚨 PUT Business update error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Internal server error during business update.',
                    error: error.message
                });
            }
        }
    );

    /**
     * @route PUT /api/business/:id/status
     * @desc Toggle business status (Requires Admin + Active Business)
     */
    router.put('/:id/status', 
        authenticateToken, 
        requireActiveBusiness, 
        authorize(adminRoles),
        async (req, res) => {
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

                // If admin is disabling their own business, special check
                const isAdminDisablingOwnBusiness = 
                    (req.user.businessUUID === id || req.user.associatedBusinessId === id) && 
                    ['inactive', 'disabled'].includes(status.toLowerCase());
                
                if (isAdminDisablingOwnBusiness) {
                    console.log("⚠️ Admin is attempting to disable their own business");
                    // Allow this - admin can disable their own business
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

                // Transform response with full URL
                const transformedBusiness = transformBusinessResponse(updatedBusiness);

                res.status(200).json({
                    success: true,
                    message: `Business status updated to ${status.toUpperCase()}.`,
                    data: transformedBusiness
                });

            } catch (error) {
                console.error('❌ Status update error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Internal server error during status update.'
                });
            }
        }
    );

    /**
     * @route DELETE /api/business/:id
     * @desc Delete business (Archives by setting status to 'inactive') (Requires Admin + Active Business)
     */
    router.delete('/:id', 
        authenticateToken, 
        requireActiveBusiness, 
        authorize(adminRoles),
        async (req, res) => {
            try {
                const { id } = req.params;

                const existingBusiness = await storage.getBusiness(id);
                if (!existingBusiness) {
                    return res.status(404).json({
                        success: false,
                        message: 'Business not found.'
                    });
                }

                const existingBusinessObj = existingBusiness.toObject ? existingBusiness.toObject() : existingBusiness;

                // If admin is deleting their own business, special check
                const isAdminDeletingOwnBusiness = 
                    req.user.businessUUID === id || req.user.associatedBusinessId === id;
                
                if (isAdminDeletingOwnBusiness) {
                    console.log("⚠️ Admin is attempting to delete their own business");
                    // Warn but allow
                }

                // Delete logo file if it exists and is not default
                if (existingBusinessObj.logoUrl && existingBusinessObj.logoUrl !== '/assets/logos/default_logo.svg') {
                    deleteLogoFile(existingBusinessObj.logoUrl);
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

                const archivedBusinessObj = archivedBusiness.toObject ? archivedBusiness.toObject() : archivedBusiness;

                res.status(200).json({
                    success: true,
                    message: `Business "${archivedBusinessObj.businessName}" successfully archived.`,
                    data: archivedBusinessObj
                });

            } catch (error) {
                console.error('❌ Business delete/archive error:', error);
                res.status(500).json({
                    success: false,
                    message: 'Internal server error during business deletion.'
                });
            }
        }
    );

    /**
     * @route GET /api/business/:id/status
     * @desc Get business status (Public endpoint for checking business status)
     */
    router.get('/:id/status', async (req, res) => {
        try {
            const { id } = req.params;
            
            const business = await storage.getBusiness(id);
            if (!business) {
                return res.status(404).json({
                    success: false,
                    message: 'Business not found.'
                });
            }

            res.status(200).json({
                success: true,
                data: {
                    id: business.id,
                    businessId: business.businessId,
                    businessName: business.businessName,
                    status: business.status || 'active',
                    isActive: !['inactive', 'disabled', 'suspended'].includes((business.status || '').toLowerCase())
                }
            });
        } catch (error) {
            console.error('❌ Get business status error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error.'
            });
        }
    });

    // Add test route to debug storage (with business check)
    router.get('/debug/storage', 
        authenticateToken, 
        requireActiveBusiness, 
        async (req, res) => {
            try {
                const businesses = await storage.getBusinesses();
                res.json({
                    success: true,
                    storageType: typeof storage,
                    businessesType: typeof businesses,
                    isArray: Array.isArray(businesses),
                    count: businesses?.length || 0,
                    sample: businesses?.[0] || null,
                    userBusinessId: req.user.businessUUID,
                    userBusinessStatus: req.business?.status
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }
    );

    return router;
}