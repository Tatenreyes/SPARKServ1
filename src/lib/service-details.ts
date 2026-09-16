export interface ServiceDetail {
  slug: string;
  applianceType: string;
  name: string;
  description: string;
  problems: { label: string; issue: string }[];
}

export const SERVICE_DETAILS: ServiceDetail[] = [
  { slug: "refrigerator", applianceType: "refrigerator", name: "Refrigerator", description: "Keep your food cold and your kitchen running smoothly with practical refrigerator repair support.", problems: [{ label: "Not turning on", issue: "not-turning-on" }, { label: "Not cooling", issue: "not-cooling" }, { label: "Making unusual noise", issue: "making-noise" }, { label: "Water leaking", issue: "leaking" }, { label: "Excessive ice buildup", issue: "not-defrosting" }] },
  { slug: "air-conditioner", applianceType: "aircon", name: "Air Conditioner", description: "Get your air conditioner back to comfortable, reliable cooling with help from a trusted technician.", problems: [{ label: "Not turning on", issue: "not-turning-on" }, { label: "Not cooling", issue: "not-cooling" }, { label: "Water leaking", issue: "water-leaking" }, { label: "Making unusual noise", issue: "making-noise" }, { label: "Weak airflow", issue: "weak-airflow" }] },
  { slug: "washing-machine", applianceType: "washing_machine", name: "Washing Machine", description: "From draining to spinning, get clear next steps for a washing machine that is not working as expected.", problems: [{ label: "Not turning on", issue: "not-turning-on" }, { label: "Not spinning", issue: "not-spinning" }, { label: "Not draining", issue: "not-draining" }, { label: "Water leaking", issue: "water-leaking" }, { label: "Making unusual noise", issue: "making-noise" }] },
  { slug: "television", applianceType: "tv", name: "Television", description: "Troubleshoot common TV power, display, sound, and screen problems before booking a repair.", problems: [{ label: "Not turning on", issue: "not-turning-on" }, { label: "No display", issue: "no-display" }, { label: "No sound", issue: "no-sound" }, { label: "Screen flickering", issue: "screen-flickering" }] },
  { slug: "electric-fan", applianceType: "electric_fan", name: "Electric Fan", description: "Get safe, straightforward support for fan power, speed, spinning, and noise problems.", problems: [{ label: "Not turning on", issue: "not-turning-on" }, { label: "Not spinning", issue: "not-spinning" }, { label: "Spinning slowly", issue: "slow-spinning" }, { label: "Making unusual noise", issue: "making-noise" }] },
  { slug: "other-appliances", applianceType: "other", name: "Other Home Appliances", description: "Describe the issue with another home appliance and our service team will help find the right next step.", problems: [{ label: "Not turning on", issue: "not-turning-on" }, { label: "Not working properly", issue: "other" }, { label: "Making unusual noise", issue: "making-noise" }, { label: "Leaking water", issue: "water-leaking" }] },
];

export function getServiceDetail(slug: string) {
  return SERVICE_DETAILS.find((service) => service.slug === slug);
}