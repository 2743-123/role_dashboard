import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { In } from "typeorm";

import { MaterialAccount } from "../models/materialaccount";
import { User } from "../models/User";
import { Token } from "../models/Token";

const tokenRepo = AppDataSource.getRepository(Token);
const accountRepo = AppDataSource.getRepository(MaterialAccount);
const userRepo = AppDataSource.getRepository(User);

//////////////////////////////////////////////////////////////
// 🟢 1. CREATE TOKEN
//////////////////////////////////////////////////////////////

export const createToken = async (req: Request, res: Response) => {
  try {
    const { customerName, truckNumber, materialType, userId } = req.body;

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const lastToken = await tokenRepo.findOne({
      where: { customerName },
      order: { id: "DESC" },
    });

    const prevCarry = lastToken ? Number(lastToken.carryForward || 0) : 0;

    /** only ADVANCE goes forward */
    const carryForward = prevCarry > 0 ? prevCarry : 0;

    const token = tokenRepo.create({
      customerName,
      truckNumber,
      materialType,
      user,
      status: "pending",
      carryForward,
      paidAmount: carryForward > 0 ? carryForward : 0,
    });

    await tokenRepo.save(token);

    return res.json({ msg: "✅ Token created", data: token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};

//////////////////////////////////////////////////////////////
// 🟡 2. UPDATE TOKEN  (RUNNING LEDGER FIXED)
//////////////////////////////////////////////////////////////

// export const updateToken = async (req: Request, res: Response) => {
//   try {
//     const { tokenId, userId, weight, commission, paidAmount } = req.body;
//     const currentUser = (req as any).user;

//     const token = await tokenRepo.findOne({
//       where: { id: tokenId },
//       relations: ["user"],
//     });

//     if (!token) return res.status(404).json({ msg: "Token not found" });

//     if (currentUser.role === "user" && currentUser.id !== token.user.id) {
//       return res.status(403).json({ msg: "Access denied" });
//     }

//     let targetUser = token.user;

//     if (["admin", "superadmin"].includes(currentUser.role)) {
//       const newUser = await userRepo.findOne({ where: { id: userId } });
//       if (!newUser) return res.status(404).json({ msg: "Target user not found" });
//       targetUser = newUser;
//     }

//     /** material account */
//     const account = await accountRepo.findOne({
//       where: { user: { id: targetUser.id }, materialType: token.materialType },
//     });

//     if (!account) return res.status(400).json({ msg: "Material account not found" });

//     /** weight difference */
//     const oldWeight = token.weight || 0;
//     const newWeight = Number(weight);
//     const diff = newWeight - oldWeight;

//     if (diff > 0 && diff > Number(account.remainingTons)) {
//       return res.status(400).json({
//         msg: `Insufficient balance. Available: ${account.remainingTons}`,
//       });
//     }

//     account.usedTons += diff;
//     account.remainingTons -= diff;
//     await accountRepo.save(account);

//     /** billing */
//     const ratePerTon = 180;
//     const totalAmount = newWeight * ratePerTon + Number(commission);

//     /** 🔎 previous token of same customer */
//     const prevToken = await tokenRepo
//       .createQueryBuilder("t")
//       .where("t.customerName = :customerName", { customerName: token.customerName })
//       .andWhere("t.id < :id", { id: token.id })
//       .orderBy("t.id", "DESC")
//       .getOne();

//     const prevCarry = prevToken ? Number(prevToken.carryForward || 0) : 0;

//     /**
//      ⭐ RUNNING LEDGER
//      previousCarry + (paid − total)
//     */
//     const carryForward = Number(
//       (prevCarry + Number(paidAmount) - totalAmount).toFixed(2)
//     );

//     token.user = targetUser;
//     token.weight = newWeight;
//     token.commission = Number(commission);
//     token.ratePerTon = ratePerTon;
//     token.totalAmount = totalAmount;
//     token.paidAmount = Number(paidAmount);
//     token.carryForward = carryForward;
//     token.status = carryForward === 0 ? "completed" : "updated";

//     await tokenRepo.save(token);

//     return res.json({
//       msg: "✅ Token updated",
//       data: token,
//     });
//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ msg: "Server error" });
//   }
// };
export const updateToken = async (req: Request, res: Response) => {
  try {
    const { tokenId, userId, weight, commission } = req.body; // ❌ paidAmount removed
    const currentUser = (req as any).user;

    const token = await tokenRepo.findOne({
      where: { id: tokenId },
      relations: ["user"],
    });

    if (!token) return res.status(404).json({ msg: "Token not found" });

    if (currentUser.role === "user" && currentUser.id !== token.user.id) {
      return res.status(403).json({ msg: "Access denied" });
    }

    let targetUser = token.user;

    if (["admin", "superadmin"].includes(currentUser.role)) {
      const newUser = await userRepo.findOne({ where: { id: userId } });
      if (!newUser) return res.status(404).json({ msg: "Target user not found" });
      targetUser = newUser;
    }

    /** material account */
    const account = await accountRepo.findOne({
      where: { user: { id: targetUser.id }, materialType: token.materialType },
    });

    if (!account) return res.status(400).json({ msg: "Material account not found" });

    /** weight diff */
    const oldWeight = token.weight || 0;
    const newWeight = Number(weight);
    const diff = newWeight - oldWeight;

    if (diff > 0 && diff > Number(account.remainingTons)) {
      return res.status(400).json({
        msg: `Insufficient balance. Available: ${account.remainingTons}`,
      });
    }

    account.usedTons += diff;
    account.remainingTons -= diff;
    await accountRepo.save(account);

    /** billing */
    const ratePerTon = 180;
    const totalAmount = newWeight * ratePerTon + Number(commission);

    /** previous token carry */
    const prevToken = await tokenRepo
      .createQueryBuilder("t")
      .where("t.customerName = :customerName", { customerName: token.customerName })
      .andWhere("t.id < :id", { id: token.id })
      .orderBy("t.id", "DESC")
      .getOne();

    const prevCarry = prevToken ? Number(prevToken.carryForward || 0) : 0;

    /**
     ⭐ RUNNING DUE
     previousCarry − totalAmount
    */
    const carryForward = Number((prevCarry - totalAmount).toFixed(2));

    token.user = targetUser;
    token.weight = newWeight;
    token.commission = Number(commission);
    token.ratePerTon = ratePerTon;
    token.totalAmount = totalAmount;

    // ❌ DO NOT TOUCH paidAmount here

    token.carryForward = carryForward;
    token.status = carryForward === 0 ? "completed" : "updated";

    await tokenRepo.save(token);

    return res.json({
      msg: "✅ Token updated (payment untouched)",
      data: token,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};


//////////////////////////////////////////////////////////////
// 🔵 3. CONFIRM PAYMENT — REAL LEDGER ENGINE
//////////////////////////////////////////////////////////////

export const confirmToken = async (req: Request, res: Response) => {
  try {
    const { tokenId, paidAmount } = req.body;
    const currentUser = req.user!;

    const token = await tokenRepo.findOne({
      where: { id: tokenId },
      relations: ["user"],
    });

    if (!token) return res.status(404).json({ msg: "Token not found" });

    if (currentUser.role === "user" && currentUser.id !== token.user.id) {
      return res.status(403).json({ msg: "Access denied" });
    }

    const tokens = await tokenRepo.find({
      where: { customerName: token.customerName },
      order: { id: "ASC" },
    });

    let remainingPayment = Number(paidAmount);

    for (const t of tokens) {
      const total = Number(t.totalAmount || 0);
      const alreadyPaid = Number(t.paidAmount || 0);
      const due = total - alreadyPaid;

      /** 🛑 first reset carry of old tokens */
      t.carryForward = 0;

      if (remainingPayment <= 0) {
        await tokenRepo.save(t);
        continue;
      }

      if (remainingPayment >= due) {
        /** fully paid */
        t.paidAmount = total;
        t.status = "completed";
        t.confirmedAt = new Date();

        remainingPayment -= due;
      } else {
        /** partial */
        t.paidAmount = alreadyPaid + remainingPayment;
        t.carryForward = Number((t.paidAmount - total).toFixed(2)); // negative
        t.status = "updated";
        t.confirmedAt = new Date();

        remainingPayment = 0;
      }

      await tokenRepo.save(t);
    }

    /** advance case → ONLY last token */
    if (remainingPayment > 0 && tokens.length > 0) {
      const last = tokens[tokens.length - 1];

      last.carryForward = Number(remainingPayment.toFixed(2)); // positive
      last.status = "completed";
      last.confirmedAt = new Date();

      await tokenRepo.save(last);
    }

    return res.json({
      msg: "✅ Ledger perfectly balanced",
      customerName: token.customerName,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};


//////////////////////////////////////////////////////////////
// 🟣 4. GET TOKENS BY USER
//////////////////////////////////////////////////////////////

export const getAllTokens = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (req.user!.role === "user" && req.user!.id !== Number(userId)) {
      return res.status(403).json({ msg: "Access denied" });
    }

    const tokens = await tokenRepo.find({
      where: { user: { id: Number(userId) } },
      relations: ["user"],
      order: { id: "DESC" },
    });

    return res.json({
      msg: "✅ Tokens fetched",
      count: tokens.length,
      data: tokens,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};

//////////////////////////////////////////////////////////////
// 🔴 5. ADMIN TOKEN REPORT
//////////////////////////////////////////////////////////////

export const getAdminAllUserTokens = async (req: Request, res: Response) => {
  try {
    const currentUser = req.user!;

    if (currentUser.role === "user") {
      return res.status(403).json({ msg: "Access denied" });
    }

    let users: User[] = [];

    if (currentUser.role === "superadmin") {
      users = await userRepo.find({ where: { role: "user" } });
    } else {
      users = await userRepo.find({
        where: { role: "user", createdBy: currentUser.id },
      });
    }

    const userIds = users.map((u) => u.id);

    const tokens = await tokenRepo.find({
      where: { user: { id: In(userIds) } },
      relations: ["user"],
      order: { id: "DESC" },
    });

    const accounts = await accountRepo.find({
      where: { user: { id: In(userIds) } },
      relations: ["user"],
    });

    const getRemaining = (userId: number, material: string) => {
      const acc = accounts.find(
        (a) => a.user.id === userId && a.materialType === material
      );
      return acc ? Number(acc.remainingTons).toFixed(3) : "0.000";
    };

    const table = tokens.map((t) => ({
      tokenId: t.id,
      customerName: t.customerName,
      truckNumber: t.truckNumber,
      materialType: t.materialType,
      weight: t.weight,
      carryForward: t.carryForward,
      status: t.status,
      userId: t.user.id,
      userName: t.user.name,
      remainingTons: getRemaining(t.user.id, t.materialType),
      createdAt: t.createdAt,
      confirmedAt: t.confirmedAt,
    }));

    return res.json({
      msg: "✅ Admin token report fetched",
      totalTokens: table.length,
      data: table,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
};
