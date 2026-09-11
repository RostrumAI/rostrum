export default function loadVendor(value: any): number {
    if (value === null) return 0;
    console.log("vendor loaded", value);
    return Number.parseInt(value, 10);
}
