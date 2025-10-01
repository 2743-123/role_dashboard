import { Request, Response, RequestHandler } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import { logger } from "../config/logger";
import { error } from "console";

interface AuthenticatedRequest extends Request {
  user: {
    id: number;
    role: "admin" | "user" | "superadmin"; // jo bhi roles hain aapke system me
  };
}

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
const userRepo = AppDataSource.getRepository(User);

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, role } = req.body;

    logger.info(`register attempt by ${email}`);

    const existingUser = await userRepo.findOneBy({ email });
    if (existingUser) {
      logger.warn(`existing user ${email}`);
      return res.status(400).json({ msg: "User already exist" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = userRepo.create({ email, password: hashedPassword, role });
    await userRepo.save(newUser);
    res.json({ msg: " User Register Succesfully" });
    logger.info(`Register Sucess: ${email}`);
  } catch (err: any) {
    logger.error(`register error ${req.body.email}:${err.message}`);
    res.status(500).json({ msg: "Erro Registering User", error: err });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    console.log("request body",req.body)

    logger.info(`Login attempt by: ${email}`);

    const user = await userRepo.findOneBy({ email });
    if (!user) {
      logger.warn(`Login failed(user not found: ${email})`);
      return res.status(400).json({ msg: "Invalid Credintial" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.warn(`login failed (Wrong password): ${email}`);
      return res.status(400).json({ msg: "Invalid Credintail" });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, {
      expiresIn: "1h",
    });
    res.json({ token, role: user.role });
    logger.info(`login success: ${email}, role: ${user.role}`);
  } catch (err: any) {
    logger.error(`login error for  ${req.body.email}: ${err.message}`);
    res.status(500).json({ msg: "Error logging in ", error: err });
  }
};

export const getUser = async (req: Request, res: Response) => {
  try {
    const users = await userRepo.find({
      select: ["id", "email", "role", "isActive"],
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Error fetching users", error });
  }
};

// export const updateuser = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;
//     const { email, password, role, isActive } = req.body;

//     const user = await userRepo.findOneBy({ id: parseInt(id) });
//     if (!user) return res.status(404).json({ message: "User Not Found" });
//     if (password) user.password = await bcrypt.hash(password, 10);
//     if (email) user.email = email;
//     if (role) user.role = role;
//     if (isActive) user.isActive = isActive;

//     await userRepo.save(user);

//     res.json({ message: "user update succesfull", user });
//   } catch (error) {
//     res.status(500).json({ message: "Error updating user", error });
//   }
// };

// export const updateuser = async (req: AuthenticatedRequest,res: Response) => {
//   try {
//     const { id } = req.params;
//     const { email, password, role, isActive } = req.body;

//     const user = await userRepo.findOneBy({ id: parseInt(id) });
//     if (!user) return res.status(404).json({ message: "User Not Found" });

//     // ---- Role-based restrictions ----
//     if (req.user.role === "admin") {
//       if (user.role !== "user") {
//         return res.status(403).json({ message: "Admin can only update users" });
//       }
//       if (user.id === req.user.id) {
//         return res.status(403).json({ message: "Admin cannot update themselves" });
//       }
//     } else if (req.user.role === "user") {
//       return res.status(403).json({ message: "Users cannot update anyone" });
//     }

//     // ---- Update fields ----
//     if (password) user.password = await bcrypt.hash(password, 10);
//     if (email) user.email = email;
//     if (role) user.role = role;
//     if (typeof isActive === "boolean") user.isActive = isActive;

//     await userRepo.save(user);

//     res.json({ message: "User update successful", user });
//   } catch (error) {
//     res.status(500).json({ message: "Error updating user", error });
//   }
// };

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: number;
      role: string;
    };
  }
}
export const updateuser: RequestHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, role, isActive } = req.body;

    const user = await userRepo.findOneBy({ id: parseInt(id) });
    if (!user) return res.status(404).json({ message: "User Not Found" });

    // role-based restrictions
    if (req.user?.role === "admin") {
      if (user.role !== "user") {
        return res.status(403).json({ message: "Admin can only update users" });
      }
      if (user.id === req.user.id) {
        return res
          .status(403)
          .json({ message: "Admin cannot update themselves" });
      }
    } else if (req.user?.role === "user") {
      return res.status(403).json({ message: "Users cannot update anyone" });
    }

    // update fields
    if (password) user.password = await bcrypt.hash(password, 10);
    if (email) user.email = email;
    if (role) user.role = role;
    if (typeof isActive === "boolean") user.isActive = isActive;

    await userRepo.save(user);

    res.json({ message: "User update successful", user });
  } catch (error) {
    res.status(500).json({ message: "Error updating user", error });
  }
};

// export const deleteUser = async(req : Request, res:Response)=>{
//       try{
//         const {id} = req.params;
//         const user = await userRepo.findOneBy({id: parseInt(id)});
//         if(!user) return res.status(404).json({message: "User Not Found"});
//         await userRepo.remove(user);
//         res.json({message : "User Deleted Succesfully"});

//       }catch(error){

//         res.status(500).json({message: " Error Delating User", error})
//       }
// }
export const deleteUser: RequestHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await userRepo.findOneBy({ id: parseInt(id) });
    if (!user) return res.status(404).json({ message: "User Not Found" });

    // ✅ Check if user is inactive
    if (user.isActive) {
      return res
        .status(403)
        .json({ message: "Active users cannot be deleted" });
    }

    await userRepo.remove(user);
    res.json({ message: "User Deleted Successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error Deleting User", error });
  }
};

// export const deleteUser = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;

//     const targetUser = await userRepo.findOneBy({ id: parseInt(id) });
//     if (!targetUser) return res.status(404).json({ message: "User not found" });

//     // ---- Role-based restrictions ----
//     if (req.user.role === "admin") {
//       if (targetUser.role !== "user") {
//         return res.status(403).json({ message: "Admin can only delete users" });
//       }
//       if (targetUser.id === req.user.id) {
//         return res.status(403).json({ message: "Admin cannot delete themselves" });
//       }
//     } else if (req.user.role === "user") {
//       return res.status(403).json({ message: "Users cannot delete anyone" });
//     }

//     // ---- Active check ----
//     if (targetUser.isActive) {
//       return res.status(400).json({ message: "User must be inactive before deletion" });
//     }

//     await userRepo.remove(targetUser);

//     res.json({ message: "User deleted successfully" });
//   } catch (error) {
//     res.status(500).json({ message: "Error deleting user", error });
//   }
// };