import { Request, Response } from "express";
import { AppDataSource } from "../config/db";

import { MaterialAccount } from "../models/materialaccount";
import { User } from "../models/User";
import { Token } from "../models/Token";


const tokenRepo = AppDataSource.getRepository(Token);
const accountRepo = AppDataSource.getRepository(MaterialAccount);
const userRepo = AppDataSource.getRepository(User);

// 🟢 1. Create Token (pending)
export const createToken = async (req: Request, res: Response) => {
  try {
    const { customerName, truckNumber, materialType, userId } = req.body;

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const token = tokenRepo.create({
      customerName,
      truckNumber,
      materialType,
      user,
      status: "pending",
    });

    await tokenRepo.save(token);

    res.json({ msg: "Token created", data: token });
  } catch (err) {
    console.error("Error in createToken:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

// 🟠 2. Update Token (weight, commission → totalAmount)
// export const updateToken = async (req: Request, res: Response) => {
//   try {
//     const { tokenId, weight, commission } = req.body;

//     const token = await tokenRepo.findOne({
//       where: { id: tokenId },
//       relations: ["user"],
//     });
//     if (!token) return res.status(404).json({ msg: "Token not found" });

//     const ratePerTon = 180; // fix for now
//     const totalAmount = Number(weight) * ratePerTon + Number(commission);

//     // Update material account
//     const account = await accountRepo.findOne({
//       where: {
//         user: { id: token.user.id },
//         materialType: token.materialType,
//       },
//     });

//     if (account) {
//       account.remainingTons = Number(account.remainingTons) - Number(weight);
//       if (account.remainingTons < 0) account.remainingTons = 0;
//       await accountRepo.save(account);
//     }

//     token.weight = weight;
//     token.commission = commission;
//     token.totalAmount = totalAmount;
//     token.ratePerTon = ratePerTon;
//     token.status = "updated";

//     await tokenRepo.save(token);

//     res.json({ msg: "Token updated", data: token });
//   } catch (err) {
//     console.error("Error in updateToken:", err);
//     res.status(500).json({ msg: "Server error" });
//   }
// export const updateToken = async (req: Request, res: Response) => {
//   try {
//     const { tokenId, userId, weight, commission, paidAmount } = req.body;
//     const currentUser = req.user!; // 🔹 Token se login user (superadmin/admin/user)

//     // 1️⃣ Token find karo
//     const token = await tokenRepo.findOne({
//       where: { id: tokenId },
//       relations: ["user"],
//     });
//     if (!token) return res.status(404).json({ msg: "Token not found" });

//     // 2️⃣ Role-based access control
//     if (currentUser.role === "user" && currentUser.id !== token.user.id) {
//       return res
//         .status(403)
//         .json({ msg: "❌ Access Denied: You can update only your own tokens" });
//     }

//     // 3️⃣ Superadmin/Admin kisi bhi user ke liye update kar sakte hain
//     let targetUser = token.user;

//     if (["admin", "superadmin"].includes(currentUser.role)) {
//       const newUser = await userRepo.findOne({ where: { id: userId } });
//       if (!newUser)
//         return res.status(404).json({ msg: "Target user not found" });
//       targetUser = newUser;
//     }

//     // 4️⃣ Calculation
//     const ratePerTon = 180;
//     const totalAmount = Number(weight) * ratePerTon + Number(commission);
//     const carryForward = totalAmount - Number(paidAmount);

//     // 5️⃣ Update token
//     token.user = targetUser; // ✅ SuperAdmin ne kis user ke liye kiya
//     token.weight = Number(weight);
//     token.commission = Number(commission);
//     token.ratePerTon = ratePerTon;
//     token.totalAmount = totalAmount;
//     token.paidAmount = paidAmount;
//     token.carryForward = Number(carryForward.toFixed(2));
//     token.status = "updated";

//     await tokenRepo.save(token);

//     // 6️⃣ Update material account of target user
//     const account = await accountRepo.findOne({
//       where: {
//         user: { id: targetUser.id },
//         materialType: token.materialType,
//       },
//     });

//     if (account) {
//       account.usedTons = Number(account.usedTons) + Number(weight);
//       account.remainingTons = Number(account.remainingTons) - Number(weight);
//       if (account.remainingTons < 0) account.remainingTons = 0;
//       await accountRepo.save(account);
//     }

//     return res.json({
//       msg: "✅ Token updated successfully",
//       data: token,
//     });
//   } catch (err) {
//     console.error("Error in updateToken:", err);
//     res.status(500).json({ msg: "Server error" });
//   }
// };
export const updateToken = async (req: Request, res: Response) => {
  try {
    const { tokenId, userId, weight, commission, paidAmount } = req.body;
    const currentUser = req.user!; // 🔹 Login user (superadmin/admin/user)

    // 1️⃣ Token find karo
    const token = await tokenRepo.findOne({
      where: { id: tokenId },
      relations: ["user"],
    });
    if (!token) return res.status(404).json({ msg: "❌ Token not found" });

    // 2️⃣ Role-based access control
    if (currentUser.role === "user" && currentUser.id !== token.user.id) {
      return res.status(403).json({
        msg: "❌ Access Denied: You can update only your own tokens",
      });
    }

    // 3️⃣ Superadmin/Admin kisi bhi user ke liye update kar sakte hain
    let targetUser = token.user;

    if (["admin", "superadmin"].includes(currentUser.role)) {
      const newUser = await userRepo.findOne({ where: { id: userId } });
      if (!newUser)
        return res.status(404).json({ msg: "❌ Target user not found" });
      targetUser = newUser;
    }

    // 4️⃣ Material account nikaalo
    const account = await accountRepo.findOne({
      where: {
        user: { id: targetUser.id },
        materialType: token.materialType,
      },
    });

    if (!account) {
      return res
        .status(400)
        .json({ msg: "❌ Material account not found for this user" });
    }

    // 🧮 5️⃣ Balance check before update
    if (Number(weight) > Number(account.remainingTons)) {
      return res.status(400).json({
        msg: `❌ Insufficient balance. Available: ${account.remainingTons} tons, Requested: ${weight} tons`,
      });
    }

    // 6️⃣ Calculation
    const ratePerTon = 180;
    const totalAmount = Number(weight) * ratePerTon + Number(commission);
    const carryForward = totalAmount - Number(paidAmount);

    // 7️⃣ Update token
    token.user = targetUser;
    token.weight = Number(weight);
    token.commission = Number(commission);
    token.ratePerTon = ratePerTon;
    token.totalAmount = totalAmount;
    token.paidAmount = Number(paidAmount);
    token.carryForward = Number(carryForward.toFixed(2));
    token.status = "updated";

    await tokenRepo.save(token);

    // 8️⃣ Update material account
    account.usedTons = Number(account.usedTons) + Number(weight);
    account.remainingTons = Number(account.remainingTons) - Number(weight);
    if (account.remainingTons < 0) account.remainingTons = 0;

    await accountRepo.save(account);

    // ✅ Done
    return res.json({
      msg: "✅ Token updated successfully",
      data: token,
    });
  } catch (err) {
    console.error("Error in updateToken:", err);
    res.status(500).json({ msg: "❌ Server error" });
  }
};




// 🔵 3. Confirm Token (final submit)
export const confirmToken = async (req: Request, res: Response) => {
  try {
    const { tokenId, paidAmount } = req.body;
    const currentUser = req.user!; // jo login hai (superadmin, admin, user)

    // 1️⃣ Token find karo
    const token = await tokenRepo.findOne({
      where: { id: tokenId },
      relations: ["user"],
    });
    if (!token) return res.status(404).json({ msg: "❌ Token not found" });

    // 2️⃣ Role-based check
    if (currentUser.role === "user" && currentUser.id !== token.user.id) {
      return res
        .status(403)
        .json({ msg: "❌ Access Denied: You can confirm only your own tokens" });
    }

    // 3️⃣ Basic calculation
    const totalAmount = Number(token.totalAmount);
    const paid = Number(paidAmount);
    const carryForward = totalAmount - paid;

    // 4️⃣ Token update
    token.paidAmount = Number(paid.toFixed(2));
    token.carryForward = Number(carryForward.toFixed(2));
    token.status = "completed";

    await tokenRepo.save(token);

    // 5️⃣ Update user account balance (credit/debit logic)
    const account = await accountRepo.findOne({
      where: {
        user: { id: token.user.id },
        materialType: token.materialType,
      },
    });

    if (account) {
      // 🔹 Agar carryForward > 0 => user ne kam paise diye => debit
      // 🔹 Agar carryForward < 0 => user ne jyada paise diye => credit
      if (carryForward > 0) {
        account.remainingTons = Number(account.remainingTons); // no change
        await accountRepo.save(account);
      } else if (carryForward < 0) {
        account.remainingTons = Number(account.remainingTons); // no change
        await accountRepo.save(account);
      }
    }

    // 6️⃣ Optional: Transaction record (credit/debit)
    const transactionMsg =
      carryForward > 0
        ? `💸 Remaining balance: ₹${carryForward.toFixed(
            2
          )} (to be paid later)`
        : carryForward < 0
        ? `💰 Extra paid: ₹${Math.abs(carryForward).toFixed(2)} (credit)`
        : `✅ Fully paid`;

    return res.json({
      msg: "✅ Token confirmed successfully",
      data: {
        id: token.id,
        customerName: token.customerName,
        materialType: token.materialType,
        totalAmount: totalAmount.toFixed(2),
        paidAmount: paid.toFixed(2),
        carryForward: carryForward.toFixed(2),
        status: token.status,
        user: {
          id: token.user.id,
          name: token.user.name,
        },
        note: transactionMsg,
      },
    });
  } catch (err) {
    console.error("Error in confirmToken:", err);
    return res.status(500).json({ msg: "❌ Server Error" });
  }
};

// 🔹 4. Get Token List
// export const getAllTokens = async (req: Request, res: Response) => {
//   try {
//     const currentUser = req.user!;

//     let whereCondition = {};

//     // 🧩 If normal user → only his tokens
//     if (currentUser.role === "user") {
//       whereCondition = { user: { id: currentUser.id } };
//     }

//     // 🧩 Fetch tokens with relation
//     const tokens = await tokenRepo.find({
//       where: whereCondition,
//       relations: ["user"],
//       order: { id: "DESC" },
//     });

//     res.json(tokens);
//   } catch (err) {
//     console.error("Error fetching tokens:", err);
//     res.status(500).json({ msg: "Server error" });
//   }
// };

export const getAllTokens = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // 🧩 Security check
    if (req.user!.role === "user" && req.user!.id !== Number(userId)) {
      return res.status(403).json({ msg: "Access Denied" });
    }

    const user = await userRepo.findOne({ where: { id: Number(userId) } });
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    const tokens = await tokenRepo.find({
      where: { user: { id: user.id } },
      relations: ["user"],
      order: { id: "DESC" },
    });

    return res.json({
      msg: "✅ Tokens fetched successfully",
      count: tokens.length,
      data: tokens,
    });
  } catch (error) {
    console.error("Error in getTokensByUser:", error);
    return res.status(500).json({ msg: "Internal Server Error" });
  }
};