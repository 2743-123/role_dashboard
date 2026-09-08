import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { PaymentHistory } from "../models/PaymentHistory";

const historyRepo = AppDataSource.getRepository(PaymentHistory);

export const getPaymentHistory = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    let history = [];

    if (currentUser.role === "superadmin") {
      history = await historyRepo.find({
        relations: ["user", "admin"],
        order: { createdAt: "DESC" }
      });
    } else if (currentUser.role === "admin") {
      history = await historyRepo.find({
        where: [
          { admin: { id: currentUser.id } }, // Payment added by this admin
          { user: { creator: { id: currentUser.id } } } // Payment related to users of this admin
        ],
        relations: ["user", "admin"],
        order: { createdAt: "DESC" }
      });
    } else {
      history = await historyRepo.find({
        where: { user: { id: currentUser.id } },
        relations: ["user", "admin"],
        order: { createdAt: "DESC" }
      });
    }

    // Response Format Clean kar rahe hain taaki Frontend par aasaani se dikhe
    const formattedHistory = history.map(h => ({
      id: h.id,
      date: h.createdAt,
      type: h.type,
      amount: Number(h.amount),
      userName: h.user?.name || "Unknown",
      adminName: h.admin?.name || "System",
      details: h.details
    }));

    res.json({ msg: "✅ Payment history fetched", data: formattedHistory });
  } catch (err) {
    console.error("Payment history error:", err);
    res.status(500).json({ msg: "Server error" });
  }
};