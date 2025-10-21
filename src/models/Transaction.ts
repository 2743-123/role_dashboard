import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from "typeorm";
import { User } from "./User";

@Entity()
export class Transaction {
  @PrimaryGeneratedColumn()
  id!: number;

  // Relationship with User
  @ManyToOne(() => User, (user) => user.transactions, { onDelete: "CASCADE" })
  user!: User;

  // Total amount in rupees (flyash + bedash)
  @Column({ type: "numeric", precision: 12, scale: 2, default: 0 })
  totalAmount!: number;

  // Flyash and Bedash rupee amounts
  @Column({ type: "numeric", precision: 12, scale: 2, default: 0 })
  flyashAmount!: number;

  @Column({ type: "numeric", precision: 12, scale: 2, default: 0 })
  bedashAmount!: number;

  // Tons (converted from rupees / rate per ton)
  @Column({ type: "numeric", precision: 12, scale: 3, default: 0 })
  flyashTons!: number;

  @Column({ type: "numeric", precision: 12, scale: 3, default: 0 })
  bedashTons!: number;

  // Payment Mode (cash or online)
  @Column({ type: "varchar", length: 10 })
  paymentMode!: "cash" | "online";

  // Optional fields for extra payment details
  @Column({ type: "varchar", length: 100, nullable: true })
  bankName!: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  accountHolder!: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  referenceNumber!: string | null;

  // Auto set when transaction is created
  @CreateDateColumn()
  createdAt!: Date;
}
