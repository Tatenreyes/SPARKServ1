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
  { value: "refrigerator", label: "Refrigerator", icon: Snowflake, category: "cooling", image: "/images/refrigerator.png" },
  { value: "aircon", label: "Air Conditioner", icon: Wind, category: "cooling", image: "/images/Aircon.PNG" },
  { value: "washing_machine", label: "Washing Machine", icon: Waves, category: "laundry", image: "/images/Washing machine.PNG" },
  { value: "tv", label: "Television", icon: Tv, category: "entertainment", image: "/images/tv.jpg" },
  { value: "electric_fan", label: "Electric Fan", icon: Fan, category: "cooling" },
  { value: "microwave", label: "Microwave Oven", icon: Zap, category: "kitchen", image: "/images/Microwave oven.PNG" },
  { value: "rice_cooker", label: "Rice Cooker", icon: CookingPot, category: "kitchen", image: "/images/Rice cooker.PNG" },
  { value: "electric_stove", label: "Electric Stove", icon: Flame, category: "kitchen" },
  { value: "induction_cooker", label: "Induction Cooker", icon: Flame, category: "kitchen" },
  { value: "water_dispenser", label: "Water Dispenser", icon: Droplet, category: "kitchen", image: "/images/waterdispenser.jpg" },
  { value: "electric_kettle", label: "Electric Kettle", icon: Coffee, category: "kitchen", image: "/images/electric kettles.PNG" },
  { value: "vacuum_cleaner", label: "Vacuum Cleaner", icon: Wind, category: "cleaning", image: "/images/Vaccume.PNG" },
  { value: "clothes_dryer", label: "Clothes Dryer", icon: Shirt, category: "laundry", image: "/images/Dryers.PNG" },
  { value: "freezer", label: "Freezer", icon: Snowflake, category: "cooling", image: "/images/Freezer.PNG" },
  { value: "water_heater", label: "Water Heater", icon: Thermometer, category: "heating" },
  { value: "other", label: "Other", icon: Wrench, category: "other" },
];

export function getApplianceIcon(value: string): LucideIcon {
  return APPLIANCES.find((a) => a.value === value)?.icon ?? Wrench;
}

export function getApplianceLabel(value: string): string {
  return APPLIANCES.find((a) => a.value === value)?.label ?? value.replace(/_/g, " ");
}
