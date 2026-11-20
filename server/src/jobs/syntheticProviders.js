export const dentalSpecialties = [
  'General Dentistry',
  'Oral Medicine and Radiology',
  'Oral and Maxillofacial Surgery',
  'Orthodontics',
  'Periodontics',
  'Endodontics',
  'Pediatric Dentistry',
  'Prosthodontics',
];

const weeklyHours = [
  { day: 'mon', opensAt: '09:00', closesAt: '18:30', closed: false },
  { day: 'tue', opensAt: '09:00', closesAt: '18:30', closed: false },
  { day: 'wed', opensAt: '09:00', closesAt: '18:30', closed: false },
  { day: 'thu', opensAt: '09:00', closesAt: '18:30', closed: false },
  { day: 'fri', opensAt: '09:00', closesAt: '18:30', closed: false },
  { day: 'sat', opensAt: '09:00', closesAt: '14:30', closed: false },
  { day: 'sun', closed: true },
];

export const syntheticFacilities = [
  ...Array.from({ length: 5 }, (_, index) => ({
    name: `Synthetic Demo Community ${index % 2 === 0 ? 'Dental' : 'Cancer Referral'} Center ${String(index + 1).padStart(2, '0')}`,
    code: `SYN-ASR-HOSP-${String(index + 1).padStart(2, '0')}`,
    facilityType: 'hospital',
    centerType: index % 2 === 0 ? 'dental_center' : 'cancer_center',
    ownership: index % 2 === 0 ? 'government' : 'private',
    specialties: index % 2 === 0
      ? ['Dental care', 'Oral surgery']
      : ['Cancer care', 'Oncology referral'],
    rating: null,
    address: `Synthetic Demo Campus ${index + 1}, Demo Road`,
    city: `Demo Town ${String(index + 1).padStart(2, '0')}`,
    state: 'Andhra Pradesh',
    postalCode: `0000${index + 1}`,
    district: 'Alluri Sitarama Raju District',
    mandal: `Demo Mandal ${String(index + 1).padStart(2, '0')}`,
    village: `Demo Village ${String(index + 1).padStart(2, '0')}`,
    coordinates: {
      latitude: 18.08 + index * 0.012,
      longitude: 82.66 + index * 0.014,
    },
    location: {
      type: 'Point',
      coordinates: [82.66 + index * 0.014, 18.08 + index * 0.012],
    },
    contactEmail: `hospital${index + 1}@example.invalid`,
    contactPhone: '0000000000',
    services: index % 2 === 0
      ? ['Synthetic demo dental consultations', 'Synthetic demo oral screening', 'Synthetic demo referral coordination']
      : ['Synthetic demo cancer referral coordination', 'Synthetic demo oral screening'],
    facilities: ['Synthetic demo dental unit', 'Synthetic demo consultation room'],
    workingHours: weeklyHours,
    status: 'active',
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    name: `Synthetic Demo Primary Health Centre ${String(index + 1).padStart(2, '0')}`,
    code: `SYN-ASR-PHC-${String(index + 1).padStart(2, '0')}`,
    facilityType: 'phc',
    centerType: 'phc',
    ownership: index % 2 === 0 ? 'government' : 'private',
    specialties: ['Primary care', 'Oral health referral'],
    rating: null,
    address: `Synthetic Demo PHC Campus ${index + 1}, Demo Road`,
    city: `Demo Mandal ${String(index + 1).padStart(2, '0')}`,
    state: 'Andhra Pradesh',
    postalCode: `001${String(index + 1).padStart(3, '0')}`,
    district: 'Alluri Sitarama Raju District',
    mandal: `Demo Mandal ${String(index + 1).padStart(2, '0')}`,
    village: `Demo Village ${String(index + 1).padStart(2, '0')}`,
    coordinates: {
      latitude: 18.02 + index * 0.009,
      longitude: 82.60 + index * 0.011,
    },
    location: {
      type: 'Point',
      coordinates: [82.60 + index * 0.011, 18.02 + index * 0.009],
    },
    contactEmail: `phc${index + 1}@example.invalid`,
    contactPhone: '0000000000',
    services: ['Synthetic demo primary care', 'Synthetic demo oral health referral'],
    facilities: ['Synthetic demo PHC consultation room'],
    workingHours: weeklyHours,
    status: 'active',
  })),
].map((facility) => ({ ...facility, isSynthetic: true }));

const specialtyCounts = [3, 3, 3, 3, 2, 2, 2, 2];
export const syntheticDentists = dentalSpecialties.flatMap((specialty, specialtyIndex) =>
  Array.from({ length: specialtyCounts[specialtyIndex] }, (_, specialtyDoctorIndex) => {
    const index =
      specialtyCounts.slice(0, specialtyIndex).reduce((total, count) => total + count, 0) +
      specialtyDoctorIndex;
    const facilityIndex = index < 10 ? index % 5 : 5 + (index % 10);
    return {
      index: index + 1,
      fullName: `Synthetic Demo Dentist ${String(index + 1).padStart(2, '0')}`,
      email: `dentist${String(index + 1).padStart(2, '0')}@example.invalid`,
      staffId: `SYN-ASR-DENTIST-${String(index + 1).padStart(2, '0')}`,
      specialty,
      facilityCode: syntheticFacilities[facilityIndex].code,
      qualification: `Synthetic demo qualification for ${specialty}; not a real credential`,
      registrationNumber: `SYNTHETIC-DEMO-NOT-A-REGISTRATION-${String(index + 1).padStart(2, '0')}`,
      experienceYears: 1 + ((index * 3) % 25),
      languages: ['te', 'en'],
      consultationFee: 0,
      expertise: [`Synthetic ${specialty} demo profile`],
      availability: [
        ...['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].flatMap((day) => [
          { day, startsAt: '09:00', endsAt: '12:00' },
          { day, startsAt: '14:00', endsAt: '16:00' },
          { day, startsAt: '17:00', endsAt: '18:30' },
        ]),
      ],
      verificationStatus: 'pending',
      isSynthetic: true,
    };
  }),
);

export function getSyntheticProviderCounts() {
  return {
    hospitals: syntheticFacilities.filter((facility) => facility.facilityType === 'hospital')
      .length,
    phcs: syntheticFacilities.filter((facility) => facility.facilityType === 'phc').length,
    doctors: syntheticDentists.length,
    specialties: dentalSpecialties.length,
  };
}
