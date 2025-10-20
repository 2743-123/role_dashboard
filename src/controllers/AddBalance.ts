import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { MaterialAccount } from "../models/materialaccount";
import { User } from "../models/User";

const accountRepo = AppDataSource.getRepository(MaterialAccount);
const userRepo = AppDataSource.getRepository(User);

const RATE_PER_TON = 180; // ₹180 per ton


export const addBalance = async (req: Request, res: Response) => {
  try {
    const { userId, flyashAmount, bedashAmount } = req.body;
    const currentUser = (req as any).user;

    if (!currentUser) {
      return res.status(401).json({ msg: "Unauthorized access" });
    }

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) return res.status(404).json({ msg: "User not found" });

    // ✅ Role-based permission logic
    if (currentUser.role === "user") {
      // User can only modify their own balance
      if (currentUser.id !== userId) {
        return res.status(403).json({ msg: "You can only update your own balance" });
      }
    } else if (currentUser.role === "admin" || currentUser.role === "superadmin") {
      // Admin/SuperAdmin can modify any user's balance EXCEPT their own
      if (currentUser.id === userId) {
        return res.status(403).json({
          msg: "Admins or SuperAdmins cannot modify their own balance",
        });
      }
    } else {
      return res.status(403).json({ msg: "Invalid role" });
    }

    // const RATE_PER_TON = 180;

    // Convert rupees to tons
    const flyashTons = flyashAmount ? flyashAmount / RATE_PER_TON : 0;
    const bedashTons = bedashAmount ? bedashAmount / RATE_PER_TON : 0;

    // 🧱 FLYASH MATERIAL ACCOUNT
    let flyashAccount = await accountRepo.findOne({
      where: { user: { id: user.id }, materialType: "flyash" },
    });

    if (!flyashAccount) {
      flyashAccount = accountRepo.create({
        user,
        materialType: "flyash",
        totalTons: flyashTons,
        usedTons: 0,
        remainingTons: flyashTons,
      });
    } else {
      flyashAccount.totalTons += flyashTons;
      flyashAccount.remainingTons += flyashTons;
    }

    await accountRepo.save(flyashAccount);

    // 🧱 BEDASH MATERIAL ACCOUNT
    let bedashAccount = await accountRepo.findOne({
      where: { user: { id: user.id }, materialType: "bedash" },
    });

    if (!bedashAccount) {
      bedashAccount = accountRepo.create({
        user,
        materialType: "bedash",
        totalTons: bedashTons,
        usedTons: 0,
        remainingTons: bedashTons,
      });
    } else {
      bedashAccount.totalTons += bedashTons;
      bedashAccount.remainingTons += bedashTons;
    }

    await accountRepo.save(bedashAccount);

    // ✅ Response
    return res.json({
      msg: "Balance updated successfully",
      data: {
        flyash: {
          added: flyashTons.toFixed(2),
          remaining: flyashAccount.remainingTons.toFixed(2),
        },
        bedash: {
          added: bedashTons.toFixed(2),
          remaining: bedashAccount.remainingTons.toFixed(2),
        },
      },
    });
  } catch (error) {
    console.error("Add Balance Error:", error);
    res.status(500).json({ msg: "Internal Server Error" });
  }
};

export const getBalance = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Role-based access
    if (req.user!.role === "user" && req.user!.id !== Number(userId)) {
      return res.status(403).json({ msg: "Access Denied" });
    }

    const user = await userRepo.findOne({ where: { id: Number(userId) } });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const flyashAccount = await accountRepo.findOne({
      where: { user: { id: user.id }, materialType: "flyash" },
    });

    const bedashAccount = await accountRepo.findOne({
      where: { user: { id: user.id }, materialType: "bedash" },
    });

  return res.json({
  user: user.id,
  flyash: {
    total: (flyashAccount?.totalTons ?? 0).toFixed(2),
    used: (flyashAccount?.usedTons ?? 0).toFixed(2),
    remaining: (flyashAccount?.remainingTons ?? 0).toFixed(2),
  },
  bedash: {
    total: (bedashAccount?.totalTons ?? 0).toFixed(2),
    used: (bedashAccount?.usedTons ?? 0).toFixed(2),
    remaining: (bedashAccount?.remainingTons ?? 0).toFixed(2),
  },
});
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Internal Server Error" });
  }
};
