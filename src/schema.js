// src/schemas/index.js
import { z } from "zod";

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
  )
  .optional()
  .default('/assets/logos/default_logo.svg');

export const otpSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().email("Invalid email format"),
  originalOtp: z.string().length(6, "OTP must be 6 digits"), // Store original
  maskedOtp: z.string().optional(), // Masked version for display
  type: z.enum(["login", "reset", "verification"]).default("login"),
  userId: z.string().uuid().optional().nullable(),
  expiresAt: z.date(),
  status: z.enum(["pending", "consumed", "expired", "revoked"]).default("pending"), // Changed from 'used'
  consumedAt: z.date().optional().nullable(), // Changed from 'usedAt'
  attempts: z.number().int().min(0).default(0),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export const insertOTPSchema = otpSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  expiresAt: z.date().optional().default(() => new Date(Date.now() + 10 * 60 * 1000)), // 10 minutes
});

export const updateOTPSchema = otpSchema.partial().extend({
  id: z.string().uuid(),
});

export const OTP = otpSchema;
export const InsertOTP = insertOTPSchema;
export const UpdateOTP = updateOTPSchema;


// ==================== USER SCHEMA ====================
export const userSchema = z.object({
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

export const insertUserSchema = userSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  password: z.string().min(6, "Password must be at least 6 characters long"),
});

export const updateUserSchema = insertUserSchema.partial().extend({
  id: z.string().uuid(),
});

export const User = userSchema;
export const InsertUser = insertUserSchema;
export const UpdateUser = updateUserSchema;

// ==================== BUSINESS SCHEMA ====================
export const businessSchema = z.object({
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
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export const insertBusinessSchema = businessSchema.omit({
  id: true,
  businessId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  logoFile: z.any().optional(),
});

export const updateBusinessSchema = businessSchema.omit({
  id: true,
  businessId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  logoFile: z.any().optional(),
}).partial();

export const Business = businessSchema;
export const InsertBusiness = insertBusinessSchema;
export const UpdateBusiness = updateBusinessSchema;