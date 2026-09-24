import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { In } from "typeorm";

import { User } from "../models/User";
import { MaterialAccount } from "../models/materialaccount";
import { BedashMessage } from "../models/bedashMessage";

const bedashRepo = AppDataSource.getRepository(BedashMessage);
const userRepo = AppDataSource.getRepository(User);
const accountRepo = AppDataSource.getRepository(MaterialAccount);

export const createBedash = async (req: Request, res: Response) => {
  try {
    const { userId, materialType, customDate, targetDate, amount, reminderPhone } = req.body;
    const currentUser = (req as any).user;

    // 1: Find user and verify relations
    const user = await userRepo.findOne({ 
      where: { id: userId }, 
      relations: ["creator"] 
    });
    
    if (!user) return res.status(404).json({ msg: "❌ User not found" });

    // 2: Role-based Security Validation
    if (currentUser.role === "user") {
      if (currentUser.id !== user.id) {
        return res.status(403).json({ msg: "❌ You can only create requests for yourself" });
      }
    } else if (currentUser.role === "admin") {
      if (user.creator?.id !== currentUser.id) {
        return res.status(403).json({ msg: "❌ Access Denied: Not your user" });
      }
    }

   
    const existingPendingBedash = await bedashRepo.findOne({
      where: {
        user: { id: user.id },
        status: "pending",
        materialType: materialType as "flyash" | "bedash" // Optional: Sirf same material ke liye rokna hai toh ye rakho. Warna is line ko hata doge toh dono materials pe rok lag jayegi.
      }
    });

    if (existingPendingBedash) {
      return res.status(400).json({ 
        msg: `❌ already added ${materialType}` 
      });
    }

    // 4: Create naya Bedash message
    const bedash = bedashRepo.create({
      user,
      createdBy: { id: currentUser.id } as any,
      materialType: materialType as "flyash" | "bedash",
      customDate,
      targetDate,
      status: "pending",
      amount,
      reminderPhone: reminderPhone || null, 
    });

    await bedashRepo.save(bedash);

    return res.json({
      msg: "✅ Bedash message created successfully",
      data: bedash,
    });
  } catch (err) {
    console.error("Error creating bedash:", err);
    res.status(500).json({ msg: "❌ Server error" });
  }
};

// ✅ GET BEDASH LIST
export const getBedashList = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    let bedashList;

    if (currentUser.role === "superadmin") {
      bedashList = await bedashRepo.find({ 
        relations: ["user", "createdBy"],
        order: { id: "DESC" }
      });
    } else if (currentUser.role === "admin") {
      bedashList = await bedashRepo.find({
        where: [
          { createdBy: { id: currentUser.id } },
          { user: { creator: { id: currentUser.id } } },
        ],
        relations: ["user", "createdBy"],
        order: { id: "DESC" }
      });
    } else {
      bedashList = await bedashRepo.find({
        where: { user: { id: currentUser.id } },
        relations: ["user", "createdBy"],
        order: { id: "DESC" }
      });
    }

    // Solve N+1 Issue: Batch fetch material accounts
    const userIds = [...new Set(bedashList.map((b) => b.user.id))];
    let accounts: MaterialAccount[] = [];
    
    if (userIds.length > 0) {
      accounts = await accountRepo.find({
        where: { user: { id: In(userIds) } },
        relations: ["user"],
      });
    }

    const result = bedashList.map((b) => {
      const account = accounts.find(
        (a) => a.user.id === b.user.id && a.materialType === b.materialType
      );

      return {
        id: b.id,
        userName: b.user.name,
        materialType: b.materialType,
        amount: Number(b.amount).toFixed(3), 
        remainingTons: account ? Number(account.remainingTons).toFixed(3) : "0.000",
        status: b.status,
        customDate: b.customDate,
        targetDate: b.targetDate,
        reminderPhone: b.reminderPhone, // 🟢 List me bhi phone number bhej rahe hain (optional UI display ke liye)
        createdAt: b.createdAt,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("Error fetching bedash list:", err);
    res.status(500).json({ msg: "❌ Server error" });
  }
};

// ✅ CONFIRM BEDASH (Admin, SuperAdmin aur Owner User teeno confirm kar sakte hain)
export const confirmBedash = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const currentUser = (req as any).user;

    const bedash = await bedashRepo.findOne({
      where: { id: Number(id) },
      relations: ["user", "user.creator"], 
    });

    if (!bedash) return res.status(404).json({ msg: "❌ Not found" });
    
    // 🔐 Security Validation based on Role:
    if (currentUser.role === "user") {
      if (bedash.user.id !== currentUser.id) {
        return res.status(403).json({ msg: "❌ Access Denied: Not your record" });
      }
    } else if (currentUser.role === "admin") {
      if (bedash.user.creator?.id !== currentUser.id) {
        return res.status(403).json({ msg: "❌ Access Denied: Not your user's record" });
      }
    }

    if (bedash.status === "completed") {
      return res.status(400).json({ msg: "⚠️ Bedash is already confirmed" });
    }

    // ✅ Status Completed update kar denge
    bedash.status = "completed";
    await bedashRepo.save(bedash);

    res.json({ msg: "✅ Bedash marked as completed successfully", data: bedash });
  } catch (err) {
    console.error("Error confirming bedash:", err);
    res.status(500).json({ msg: "❌ Server error" });
  }
};