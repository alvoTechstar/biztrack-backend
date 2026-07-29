const express = require('express');
const router = express.Router();
const z = require('zod');
const { insertBusinessSchema, processBusinessData, transformBusinessResponse } = require('../utils/schema.js');
const storage = require('../utils/storage.js');

// Safe map helper to prevent crashes if arrays are undefined/null
const safeMap = (array, callback) => {
    if (!Array.isArray(array)) return [];
    return array.map(callback);
};

exports.createBusiness = async (req, res) => {

    // console.log('data received:', req.body);
    
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

         // 1. Prepare data for validation including payment fields
        const businessData = {
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
                owner: body.owner,
                // Payment fields
                paymentType: body.paymentType,
                tillNumber: body.tillNumber,
                paybillNumber: body.paybillNumber,
                accountNumber: body.accountNumber,
                pochiNumber: body.pochiNumber,
                logoUrl: undefined // Will be set after validation
            };

        // Remove undefined values
        Object.keys(businessData).forEach(key =>
            businessData[key] === undefined && delete businessData[key]
        );

        console.log("✅ Business Data to validate:", businessData);

        // 2. Zod Validation
        const parsedData = insertBusinessSchema.safeParse(businessData);

        if (!parsedData.success) {
            console.error("❌ Validation Error:", parsedData.error.issues);
            const validationErrors = parsedData.error.issues.map(err => ({
                field: err.path.join('.'),
                message: err.message
            }));

            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validationErrors
            });
        }

        console.log("✅ Validated Data with Payment Config:", {
            businessName: parsedData.businessName,
            paymentConfig: parsedData.paymentConfig
        });

        // 3. Check for uniqueness
        const existingBusinessByReg = await storage.getBusinessByRegistrationNumber(parsedData.registrationNumber);
        if (existingBusinessByReg) {
            return res.status(400).json({
                success: false,
                message: 'A business with this registration number already exists.'
            });
        }

        // 4. Handle Logo Upload Logic
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
        }

        // Prepare data for storage - parsedData already has paymentConfig from transform
        const businessToSave = {
            ...parsedData,
            logoUrl, // Store relative path in database
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        console.log("💾 Saving Business Data with Payment Config:", {
            businessName: businessToSave.businessName,
            paymentConfig: businessToSave.paymentConfig,
            logoUrl: businessToSave.logoUrl
        });

        // 5. Create Business in DB (storage will auto-generate businessId)
        const newBusiness = await storage.createBusiness(businessToSave);

            // Transform response with full URL
        const transformedBusiness = transformBusinessResponse(newBusiness);

        res.status(201).json({
            success: true,
            message: 'Business created successfully.',
            business: transformedBusiness
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error("❌ Validation Error:", error.issues);
            
            // Use optional chaining instead of safeMap
            const validationErrors = error.issues.map(err => ({
                field: err.path.join('.'),
                message: err.message
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
};

exports.getAllBusinesses = async(req, res) => {
    try{
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

exports.getBusinessById = async(req, res) => {
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

exports.updateBusinessById = async(req, res) => {
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

        // 3. Prepare update data from request body including payment fields
        const updateData = {};

        // Update standard fields
        const standardFields = [
            'businessName', 'registrationNumber', 'address', 'businessType',
            'email', 'phone', 'website', 'description', 'primaryColor',
            'status', 'logoUrl', 'owner'
        ];

        standardFields.forEach(field => {
            if (field in body && body[field] !== undefined) {
                updateData[field] = body[field];
            }
        });

        // Include payment fields if they're in the request
        const paymentFields = ['paymentType', 'tillNumber', 'paybillNumber', 'accountNumber', 'pochiNumber'];
        paymentFields.forEach(field => {
            if (field in body && body[field] !== undefined) {
                updateData[field] = body[field];
            }
        });

        console.log("📝 Update Data with Payment Fields:", {
            standardFields: Object.keys(updateData).filter(k => !paymentFields.includes(k)),
            paymentFields: Object.keys(updateData).filter(k => paymentFields.includes(k))
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
            updateData.logoUrl = logoUrl;
        } else if ('logoUrl' in body) {
            // If logoUrl is explicitly provided in the request body
            if (body.logoUrl === '') {
                // Empty string means "clear logo, use default"
                if (logoUrl && logoUrl !== '/assets/logos/default_logo.svg') {
                    deleteLogoFile(logoUrl);
                }
                logoUrl = '/assets/logos/default_logo.svg';
                console.log(`🖼️ Logo cleared, using default: ${logoUrl}`);
                updateData.logoUrl = logoUrl;
            } else if (body.logoUrl && body.logoUrl !== logoUrl) {
                // New URL provided, delete old logo (if not default)
                if (logoUrl && logoUrl !== '/assets/logos/default_logo.svg') {
                    deleteLogoFile(logoUrl);
                }
                logoUrl = body.logoUrl; // Already converted to relative path
                console.log(`🖼️ Logo Update (URL): ${existingBusinessObj.logoUrl} -> ${logoUrl}`);
                updateData.logoUrl = logoUrl;
            }
        }

        // 5. Zod Validation (partial update)
        console.log("🔍 Validating update data with updateBusinessSchema:", updateData);
        const validatedData = updateBusinessSchema.parse(updateData);
        console.log("✅ Validated PUT Update Data:", {
            ...validatedData,
            paymentConfig: validatedData.paymentConfig
        });

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

        console.log("💾 PUT Updating Business Data:", {
            id,
            hasPaymentConfig: !!finalUpdatePayload.paymentConfig,
            paymentConfig: finalUpdatePayload.paymentConfig,
            logoUrl: finalUpdatePayload.logoUrl
        });

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
            console.error("❌ PUT Validation Error:", error.errors);

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

exports.updateStatus = async(req, res) => {
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
