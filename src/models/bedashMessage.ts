import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from "typeorm";
import { User } from "./User";

// Helper function to maintain consistency with Token & MaterialAccount
const numericTransformer = {
  to: (data: number) => data,
  from: (data: string) => parseFloat(data),
};

@Entity()
export class BedashMessage {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, (user) => user.bedashMessages, { onDelete: "CASCADE" })
  user!: User;

  // 🐛 FIX 1: Changed to numeric for exact decimal precision matching other tables
  @Column({
    type: "numeric",
    precision: 12,
    scale: 3,
    default: 0, // 👈 Ye line add karein taaki purane records me 0 save ho jaye
    transformer: numericTransformer,
  })
  amount!: number;

  // 🐛 FIX 2: Added strict DB Enum 
  @Column({ type: "enum", enum: ["flyash", "bedash"], default: "bedash" })
  materialType!: "flyash" | "bedash";

  @Column({ type: "date", nullable: true })
  customDate!: Date | null;

  @Column({ type: "date", nullable: true })
  targetDate!: Date | null; // completion target

  // 🐛 FIX 3: Added strict DB Enum
  @Column({ type: "enum", enum: ["pending", "completed"], default: "pending" })
  status!: "pending" | "completed";

  @CreateDateColumn()
  createdAt!: Date;

  // Relation mapping is correct, just remember to save it as an object in your controller:
  // bedashRepo.create({ ..., createdBy: { id: currentUser.id } })
  @ManyToOne(() => User, (user) => user.createdBedash, { onDelete: "CASCADE" })
  createdBy!: User;
}