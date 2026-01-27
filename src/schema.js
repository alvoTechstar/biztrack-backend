// src/schemas/index.js - FIXED USER SCHEMA WITH PROPER ZOD SYNTAX
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

// ------------------------------------------

// --- User Schemas ---

export const userSchema = z.object({
  id: z.string().optional(), // UUID - auto-generated
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
  
  // CRITICAL: Store BOTH numeric and UUID business IDs for compatibility
  businessId: z.number().int().positive().optional(), // Numeric business ID
  businessUUID: z.string().uuid().optional(), // UUID business ID
  
  // Legacy/compatibility fields
  businessName: z.string().optional(),
  associatedBusinessId: z.string().optional(), // Can be numeric string or UUID
  institutionId: z.string().optional(), // Can be numeric string or UUID
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
  // Make password required for new users
  password: z.string().min(6, "Password must be at least 6 characters long"),
});

// Update user schema (partial updates allowed)
export const updateUserSchema = insertUserSchema.partial().extend({
  id: z.string(),
});

export const User = userSchema;
export const InsertUser = insertUserSchema;
export const UpdateUser = updateUserSchema;

// ------------------------------------------

// Business schema with auto-increment businessId
export const businessSchema = z.object({
  id: z.string().optional(),
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
  logoUrl: logoUrlSchema, // Use custom validator instead of .url()
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
  businessId: true, // Remove businessId from insert - it will be auto-generated
  createdAt: true,
  updatedAt: true,
}).extend({
  logoFile: z.any().optional(),
});

// Update business schema (allow partial updates, including registrationNumber and owner)
export const updateBusinessSchema = businessSchema.omit({
  id: true,
  businessId: true, // businessId cannot be updated
  createdAt: true,
  updatedAt: true,
}).extend({
  logoFile: z.any().optional(),
}).partial(); // All fields optional for updates

export const Business = businessSchema;
export const InsertBusiness = insertBusinessSchema;
export const UpdateBusiness = updateBusinessSchema;