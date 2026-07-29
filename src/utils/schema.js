const z = require('zod');

// --- Custom validator for logo URL ---
const logoUrlSchema = z.string()
  .refine(
    (value) => {
      // Accept empty string
      if (value === '') return true;
      // Accept null
      if (value === null) return true;
      // Accept undefined
      if (value === undefined) return true;
      // Accept relative paths starting with /assets/logos/
      if (value.startsWith('/assets/logos/')) return true;
      // Accept absolute URLs
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    {
      message: 'Logo URL must be a valid URL or a relative path starting with /assets/logos/'
    }
  ).optional().default('/assets/logos/default_logo.svg');

const otpSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().email("Invalid email format"),
  originalOtp: z.string().length(6, "OTP must be 6 digits"),
  maskedOtp: z.string().optional(),
  type: z.enum(["login", "reset", "verification"]).default("login"),
  userId: z.string().uuid().optional().nullable(),
  expiresAt: z.date(),
  status: z.enum(["pending", "consumed", "expired", "revoked"]).default("pending"),
  consumedAt: z.date().optional().nullable(),
  attempts: z.number().int().min(0).default(0),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

const insertOTPSchema = otpSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  expiresAt: z.date().optional().default(() => new Date(Date.now() + 10 * 60 * 1000)),
});

const updateOTPSchema = otpSchema.partial().extend({
  id: z.string().uuid(),
});

const OTP = otpSchema;
const InsertOTP = insertOTPSchema;
const UpdateOTP = updateOTPSchema;

// ==================== USER SCHEMA ====================
const userSchema = z.object({
  id: z.string().uuid().optional(),
  username: z.string().min(1, "Username is required"),
  email: z.string().email("Invalid email format"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().min(1, "Phone is required"),
  role: z.enum([
    "Super_Admin", "Biztrack_ADMIN",
    "Hotel_Admin", "Hotel_Cashier", "Hotel_Waiter", "Hotel_Manager", "Hotel_Receptionist", "Hotel_Housekeeping",
    "Kiosk_Admin", "Kiosk_Shopkeeper",
    "Hospital_Admin", "Doctor", "Nurse", "Lab_Technician", "Receptionist", "Pharmacist",
    "Restaurant_Admin", "Restaurant_Manager", "Restaurant_Waiter", "Restaurant_Chef",
    "Retail_Admin", "Retail_Manager", "Retail_Cashier", "Retail_Sales_Associate",
  ]).default("Kiosk_Shopkeeper"),
  businessId: z.number().int().positive().optional(),
  businessUUID: z.string().uuid().optional(),
  businessName: z.string().optional(),
  associatedBusinessId: z.string().optional(),
  institutionId: z.string().optional(),
  institutionName: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  permissions: z.array(z.string()).default(["read", "write", "delete"]),
  lastLogin: z.string().default("Never"),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

const insertUserSchema = userSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  password: z.string().min(6, "Password must be at least 6 characters long"),
});

const updateUserSchema = insertUserSchema.partial().extend({
  id: z.string().uuid(),
});

const User = userSchema;
const InsertUser = insertUserSchema;
const UpdateUser = updateUserSchema;

// ==================== PAYMENT CONFIGURATION SCHEMA ====================
// ==================== PAYMENT CONFIGURATION SCHEMA ====================
const paymentConfigSchema = z.object({
  paymentType: z.enum(['TILL', 'PAYBILL', 'POCHI'], {
    errorMap: () => ({ message: "Payment type must be TILL, PAYBILL, or POCHI" })
  }).default('TILL'),

  tillNumber: z.string()
    .regex(/^\d{5,10}$/, "Till number must be 5-10 digits")
    .optional()
    .nullable()
    .default(null),

  paybillNumber: z.string()
    .regex(/^\d{5,7}$/, "Paybill number must be 5-7 digits")
    .optional()
    .nullable()
    .default(null),

  accountNumber: z.string()
    .max(50, "Account number must be at most 50 characters")
    .optional()
    .nullable()
    .default(null),

  pochiNumber: z.string()
    .optional()
    .nullable()
    .default(null)
    .transform((val) => {
      if (!val) return null;
      // Clean the number and convert to 254 format
      let formatted = val.toString().replace(/\D/g, '');

      // Handle different formats
      if (formatted.startsWith('0') && formatted.length === 10) {
        // 07XXXXXXXX or 01XXXXXXXX
        formatted = '254' + formatted.substring(1);
      } else if ((formatted.startsWith('7') || formatted.startsWith('1')) && formatted.length === 9) {
        // 7XXXXXXXX or 1XXXXXXXX
        formatted = '254' + formatted;
      } else if (formatted.startsWith('254') && formatted.length === 12) {
        // Already in 254 format
        return formatted;
      } else if (formatted.length === 9 && (formatted.startsWith('7') || formatted.startsWith('1'))) {
        formatted = '254' + formatted;
      }

      // Validate final format
      if (!/^254(7|1)\d{8}$/.test(formatted)) {
        console.warn("⚠️ Invalid phone number format after transformation:", formatted);
        return null;
      }

      return formatted;
    }),
}).refine(
  (data) => {
    // Skip validation if no payment type is set (for partial updates)
    if (!data.paymentType) return true;

    switch (data.paymentType) {
      case 'TILL':
        return !!data.tillNumber;
      case 'PAYBILL':
        return !!data.paybillNumber && !!data.accountNumber;
      case 'POCHI':
        return !!data.pochiNumber;
      default:
        return false;
    }
  },
  {
    message: "Required payment fields missing for selected payment type",
    path: ["paymentType"]
  }
);
// ==================== BASE BUSINESS SCHEMA (without transformations) ====================
const baseBusinessSchema = z.object({
  id: z.string().uuid().optional(),
  businessId: z.number().int().positive("Business ID must be a positive number"),
  businessName: z.string().min(1, "Business name is required"),
  registrationNumber: z.string().min(1, "Registration number is required"),
  businessType: z.enum(["Hotel", "Kiosk", "Hospital", "Retail", "Restaurant", "Other"], {
    errorMap: () => ({ message: "Business type is required and must be one of the allowed types" })
  }),
  email: z.string().email("Invalid email format"),
  phone: z.string().min(1, "Phone number is required"),
  address: z.string().optional().default(""),
  website: z.string().url("Invalid URL format").or(z.literal("")).or(z.literal(null)).optional().default(""),
  description: z.string().optional().default(""),
  logoUrl: logoUrlSchema,
  primaryColor: z.string()
    .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid hex color code")
    .default("#000000"),
  owner: z.string().min(1, "Owner is required"),
  status: z.enum(["active", "inactive", "new"]).default("new"),
  paymentConfig: paymentConfigSchema.default({
    paymentType: 'TILL',
    tillNumber: null,
    paybillNumber: null,
    accountNumber: null,
    pochiNumber: null
  }),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

// ==================== INSERT BUSINESS SCHEMA ====================
const insertBusinessSchema = baseBusinessSchema.omit({
  id: true,
  businessId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  logoFile: z.any().optional(),
  // Payment fields can be provided at root level for backward compatibility
  paymentType: z.enum(['TILL', 'PAYBILL', 'POCHI']).optional(),
  tillNumber: z.string().optional(),
  paybillNumber: z.string().optional(),
  accountNumber: z.string().optional(),
  pochiNumber: z.string().optional(),
}).transform((data) => {
  // Transform root level payment fields into paymentConfig object
  const {
    paymentType, tillNumber, paybillNumber, accountNumber, pochiNumber,
    ...rest
  } = data;

  // Build paymentConfig based on paymentType
  let paymentConfig = {};

  if (paymentType) {
    // Create payment config with the provided fields
    paymentConfig = {
      paymentType,
      tillNumber: tillNumber || null,
      paybillNumber: paybillNumber || null,
      accountNumber: accountNumber || null,
      pochiNumber: pochiNumber || null
    };

    console.log("💰 Building paymentConfig from provided fields:", paymentConfig);
  } else {
    // Default payment config
    paymentConfig = {
      paymentType: 'TILL',
      tillNumber: null,
      paybillNumber: null,
      accountNumber: null,
      pochiNumber: null
    };
  }

  // Return the rest of the data PLUS the paymentConfig
  return {
    ...rest,  // This includes all other fields like businessName, email, etc.
    paymentConfig // Add the payment config
  };
});

// --- Utility / Helper Functions ---
const processBusinessData = (body) => {
    const processedData = { ...body };

    // Helper to clean empty strings
    const cleanEmpty = (fields, replacement = undefined) => {
        fields.forEach(field => {
            if (processedData[field] === '') {
                processedData[field] = replacement;
            }
        });
    };

    // Convert empty strings to undefined for optional fields
    cleanEmpty(['website', 'description', 'primaryColor'], undefined);

    // Ensure status is lowercase for consistency
    if (processedData.status) {
        processedData.status = processedData.status.toLowerCase();
    }

    // Convert logoUrl to relative path if it's a full URL
    if (processedData.logoUrl && processedData.logoUrl.startsWith('http')) {
        processedData.logoUrl = getRelativeLogoPath(processedData.logoUrl);
    }

    // Handle payment fields - convert empty strings to null
    cleanEmpty(['paymentType', 'tillNumber', 'paybillNumber', 'accountNumber', 'pochiNumber'], null);

    // Log payment fields for debugging
    console.log("💰 Payment Fields from FormData:", {
        paymentType: processedData.paymentType,
        tillNumber: processedData.tillNumber,
        paybillNumber: processedData.paybillNumber,
        accountNumber: processedData.accountNumber,
        pochiNumber: processedData.pochiNumber
    });

    return processedData;
};

const transformBusinessResponse = (business) => {
    // Modify or format your business object before sending it to the client if needed
    return business;
};

// ==================== UPDATE BUSINESS SCHEMA ====================
const updateBusinessSchema = baseBusinessSchema
  .omit({
    id: true,
    businessId: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial()
  .extend({
    logoFile: z.any().optional(),
    // Allow payment fields at root level for updates
    paymentType: z.enum(['TILL', 'PAYBILL', 'POCHI']).optional(),
    tillNumber: z.string().optional(),
    paybillNumber: z.string().optional(),
    accountNumber: z.string().optional(),
    pochiNumber: z.string().optional(),
  })
  .transform((data) => {
    // Handle payment config transformation for updates
    const {
      paymentType, tillNumber, paybillNumber, accountNumber, pochiNumber,
      ...rest
    } = data;

    let result = { ...rest };

    // If any payment fields are provided, build paymentConfig
    if (paymentType !== undefined || tillNumber !== undefined ||
      paybillNumber !== undefined || accountNumber !== undefined ||
      pochiNumber !== undefined) {

      // Get existing paymentConfig from data if available
      const existingConfig = rest.paymentConfig || {};

      const updatedPaymentConfig = {
        paymentType: paymentType ?? existingConfig.paymentType ?? 'TILL',
        tillNumber: tillNumber !== undefined ? tillNumber : existingConfig.tillNumber,
        paybillNumber: paybillNumber !== undefined ? paybillNumber : existingConfig.paybillNumber,
        accountNumber: accountNumber !== undefined ? accountNumber : existingConfig.accountNumber,
        pochiNumber: pochiNumber !== undefined ? pochiNumber : existingConfig.pochiNumber,
      };

      console.log("💰 Updating paymentConfig:", updatedPaymentConfig);
      result.paymentConfig = updatedPaymentConfig;
    }

    return result;
  });

// ==================== EXPORTS ====================
const Business = baseBusinessSchema;
const InsertBusiness = insertBusinessSchema;
const UpdateBusiness = updateBusinessSchema;

// For backward compatibility
const businessSchema = baseBusinessSchema;

// ==================== EXPORTS ====================
// ==================== EXPORTS ====================
module.exports = {
    // Business Schemas & Models
    baseBusinessSchema,
    insertBusinessSchema,
    updateBusinessSchema,
    businessSchema,
    Business,
    InsertBusiness,
    UpdateBusiness,

    // User Schemas & Models
    userSchema,
    insertUserSchema,
    updateUserSchema,
    User,
    InsertUser,
    UpdateUser,

    // OTP Schemas & Models
    otpSchema,
    insertOTPSchema,
    updateOTPSchema,
    OTP,
    InsertOTP,
    UpdateOTP,

    // Utility / Helper Functions
    processBusinessData,
    transformBusinessResponse
};