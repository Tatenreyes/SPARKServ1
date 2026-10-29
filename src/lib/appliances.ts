import type { LucideIcon } from "lucide-react";
import {
  Snowflake,
  Wind,
  Waves,
  Droplet,
  Zap,
  Tv,
  Wrench,
  CookingPot,
  Flame,
  Thermometer,
  Fan,
  Coffee,
  Shirt,
} from "lucide-react";

export interface ApplianceOption {
  value: string;
  label: string;
  icon: LucideIcon;
  category: string;
  image?: string;
}

export const APPLIANCES: ApplianceOption[] = [
  { value: "refrigerator", label: "Refrigerator", icon: Snowflake, category: "cooling", image: "/images/appliances/refrigerator.png" },
  { value: "aircon", label: "Air Conditioner", icon: Wind, category: "cooling", image: "/images/appliances/air-conditioner.png" },
  { value: "washing_machine", label: "Washing Machine", icon: Waves, category: "laundry", image: "/images/appliances/washing-machine.png" },
  { value: "tv", label: "Television", icon: Tv, category: "entertainment", image: "/images/appliances/television.png" },
  { value: "electric_fan", label: "Electric Fan", icon: Fan, category: "cooling", image: "/images/appliances/electric-fan.png" },
  { value: "microwave", label: "Microwave Oven", icon: Zap, category: "kitchen", image: "/images/appliances/microwave-oven.png" },
  { value: "rice_cooker", label: "Rice Cooker", icon: CookingPot, category: "kitchen", image: "/images/appliances/rice-cooker.png" },
  { value: "electric_stove", label: "Electric Stove", icon: Flame, category: "kitchen", image: "/images/appliances/electric-stove.png" },
  { value: "induction_cooker", label: "Induction Cooker", icon: Flame, category: "kitchen", image: "/images/appliances/induction-cooker.png" },
  { value: "water_dispenser", label: "Water Dispenser", icon: Droplet, category: "kitchen", image: "/images/appliances/water-dispenser.png" },
  { value: "electric_kettle", label: "Electric Kettle", icon: Coffee, category: "kitchen", image: "/images/appliances/electric-kettle.png" },
  { value: "vacuum_cleaner", label: "Vacuum Cleaner", icon: Wind, category: "cleaning", image: "/images/appliances/vacuum-cleaner.png" },
  { value: "clothes_dryer", label: "Clothes Dryer", icon: Shirt, category: "laundry", image: "/images/appliances/clothes-dryer.png" },
  { value: "freezer", label: "Freezer", icon: Snowflake, category: "cooling", image: "/images/appliances/freezer.png" },
  { value: "water_heater", label: "Water Heater", icon: Thermometer, category: "heating", image: "/images/appliances/water-heater.png" },
  { value: "other", label: "Other", icon: Wrench, category: "other" },
];

export function getApplianceIcon(value: string): LucideIcon {
  return APPLIANCES.find((a) => a.value === value)?.icon ?? Wrench;
}

export function getApplianceLabel(value: string): string {
  return APPLIANCES.find((a) => a.value === value)?.label ?? value.replace(/_/g, " ");
}
