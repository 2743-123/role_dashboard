import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

@Entity()
export class BlacklistToken {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  token!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
