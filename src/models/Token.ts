import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Index,
} from "typeorm";
import { User } from "./User";

// Helper function: DB numbers string ban kar aate hain, unhe waapis JS Number me badalne ke liye
const numericTransformer = {
  to: (data: number) => data,
  from: (data: string) => parseFloat(data),
};

@Entity()
export class Token {
  @PrimaryGeneratedColumn()
  id!: number;

  // ⚡ Index: Customer Name se fast search ke liye
  @Index()
  @Column("varchar")
  customerName!: string;

  // ⚡ Index: Truck Number se fast search ke liye
  @Index()
  @Column("varchar", { nullable: true })
  truckNumber!: string;

  // ⚡ Index & Type Fix: Overload error bypass kiya aur indexing lagai
  @Index()
  @Column("varchar")
  materialType!: "flyash" | "bedash";

  // 🛠️ Type Fix: Numeric types ko string argument bana diya
  @Column("numeric", { precision: 12, scale: 3, default: 0, transformer: numericTransformer })
  weight!: number; // Scale 3 for tons (e.g., 15.500)

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  ratePerTon!: number;

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  commission!: number;

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  totalAmount!: number;

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  paidAmount!: number;

  @Column("numeric", { precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  carryForward!: number;

  // ⚡ Index & Type Fix: Sirf "pending" tokens fast nikalne ke liye
  @Index()
  @Column("varchar", { default: "pending" })
  status!: "pending" | "updated" | "completed";

  // ⚡ Index: Date filtering aur sorting ko fast karne ke liye
  @Index()
  @CreateDateColumn()
  createdAt!: Date;

  @Column("timestamp", { nullable: true })
  updatedAt!: Date | null;

  @Column("timestamp", { nullable: true })
  confirmedAt!: Date | null;

  // ⚡ Index: Phone number se customer history nikalne ke liye
  @Index()
  @Column("varchar", { length: 15, nullable: true })
  customerPhone!: string;

  @ManyToOne(() => User, (user) => user.tokens, {
    onDelete: "CASCADE", // 👈 Deletes token if user is deleted
    onUpdate: "CASCADE",
  })
  user!: User;
}