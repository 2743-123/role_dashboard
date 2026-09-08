import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity()
export class BlacklistToken {
  @PrimaryGeneratedColumn()
  id!: number;

  // 🐛 FIX 1 & 2: Added 'text' for long JWTs and 'unique: true' (which creates an Index) for lightning-fast lookups
 @Index()
  @Column({ 
    type: "text", 
    unique: true, 
    nullable: true // 👈 Isey add karein taaki purane records error na dein
  })
  token!: string;

  @CreateDateColumn()
  createdAt!: Date;
}