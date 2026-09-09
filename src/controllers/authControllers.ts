import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import { logger } from "../config/logger";
import { BlacklistToken } from "../models/BlackListToken";

// Interface for type safety (if you use it in middleware, otherwise optional here)
export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    role: "admin" | "user" | "superadmin";
  };
}

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
const userRepo = AppDataSource.getRepository(User);

// export const register = async (req: Request, res: Response) => {
//   try {
//     const currentUser = (req as any).user;
    
//     // 🐛 FIX 3: Check if currentUser exists (Protects against unauthenticated access)
//     if (!currentUser) {
//       return res.status(401).json({ msg: "Unauthorized" });
//     }

//     const { name, email, password, role } = req.body;

//     // Admin sirf "user" bana sakta hai
//     if (currentUser.role === "admin" && role !== "user") {
//       return res.status(403).json({ msg: "Admin can only create users" });
//     }

//     // Normal user kisi ko create nahi kar sakta
//     if (currentUser.role === "user") {
//       return res.status(403).json({ msg: "Access denied" });
//     }

//     // 🐛 FIX 2: Check for existing user to prevent DB constraint errors
//     const existingUser = await userRepo.findOne({ where: { email } });
//     if (existingUser) {
//       return res.status(400).json({ msg: "Email already in use" });
//     }

//     // Password hash
//    // Password hash
//     const hashedPassword = await bcrypt.hash(password, 10);

//     // 1. User create karein (isme createdBy mat daalein)
//     const newUser = userRepo.create({
//       name,
//       email,
//       password: hashedPassword,
//       role,
//       isActive: true,
//     });

//     // 🐛 THE MAGIC FIX: Relation explicitly set karein
//     // TypeORM ab is id ko khud 'createdBy' column me convert karke DB me save kar dega
//     newUser.creator = { id: currentUser.id } as any; 

//     // 2. Ab save karein
//     await userRepo.save(newUser);

//     // Safety: Remove password from response
//     const { password: _, ...userWithoutPassword } = newUser;
    
//     res.status(201).json({ msg: "User created successfully", user: userWithoutPassword });
//   } catch (error) {
//     console.error("Error creating user:", error);
//     res.status(500).json({ msg: "Error creating user" });
//   }
// };
export const register = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    
    // 🐛 FIX 3: Check if currentUser exists (Protects against unauthenticated access)
    if (!currentUser) {
      return res.status(401).json({ msg: "Unauthorized" });
    }

    const { name, email, password, role, phone, whatsappInstanceId, whatsappToken } = req.body;

    // Admin sirf "user" bana sakta hai
    if (currentUser.role === "admin" && role !== "user") {
      return res.status(403).json({ msg: "Admin can only create users" });
    }

    // Normal user kisi ko create nahi kar sakta
    if (currentUser.role === "user") {
      return res.status(403).json({ msg: "Access denied" });
    }

    // 🐛 FIX 2: Check for existing user to prevent DB constraint errors
    const existingUser = await userRepo.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ msg: "Email already in use" });
    }

    // Password hash
    const hashedPassword = await bcrypt.hash(password, 10);

    // 1. User create karein (Naye fields bhi include kiye gaye hain)
    const newUser = userRepo.create({
      name,
      email,
      password: hashedPassword,
      role,
      isActive: true,
      phone,
      whatsappInstanceId,
      whatsappToken,
    });

    // 🐛 THE MAGIC FIX: Relation explicitly set karein
    newUser.creator = { id: currentUser.id } as any; 

    // 2. Ab save karein
    await userRepo.save(newUser);

    // Safety: Remove password from response
    const { password: _, ...userWithoutPassword } = newUser;
    
    res.status(201).json({ msg: "User created successfully", user: userWithoutPassword });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ msg: "Error creating user" });
  }
};
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // 🐛 FIX 1: Removed console.log(req.body) to prevent password leaking in logs
    logger.info(`Login attempt by: ${email}`);

    const user = await userRepo.findOne({
      where: { email },
      relations: ["creator"],
    });

    if (!user) {
      logger.warn(`Login failed (User not found: ${email})`);
      return res.status(400).json({ msg: "Invalid Email or Password" }); // Same message for both prevents user enumeration
    }

    if (!user.isActive) {
      logger.warn(`Login blocked (Inactive user): ${email}`);
      return res.status(403).json({ msg: "Your account is inactive. Please contact admin." });
    }

    if (user.creator && !user.creator.isActive) {
      logger.warn(`Login blocked (Creator inactive): ${email}`);
      return res.status(403).json({ msg: "Your admin account is inactive. Please contact SuperAdmin." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.warn(`Login failed (Wrong password): ${email}`);
      return res.status(400).json({ msg: "Invalid Email or Password" });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).json({ token });
    logger.info(`Login success: ${email}, role: ${user.role}`);
  } catch (err: any) {
    logger.error(`Login error for ${req.body?.email}: ${err.message}`);
    res.status(500).json({ msg: "Error logging in" });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(400).json({ msg: "Token missing" });

    const blacklistRepo = AppDataSource.getRepository(BlacklistToken);
    
    // 🐛 FIX 5: Check if token is already blacklisted to prevent double-logout 500 errors
    const alreadyBlacklisted = await blacklistRepo.findOne({ where: { token } });
    if (!alreadyBlacklisted) {
      await blacklistRepo.save({ token });
    }

    res.status(200).json({ msg: "Logout successful, token invalidated" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ msg: "Server error" });
  }
};