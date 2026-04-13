/** Mock geocoding — returns Bangalore coordinates for any address */
module.exports = {
  geocodeAddress: jest.fn().mockResolvedValue({
    lat: 12.9716,
    lng: 77.5946,
    display_name: 'Bangalore, Karnataka, India',
  }),
  geocodeFromCoordinates: jest.fn().mockResolvedValue({
    address: '100 Test Street, Bangalore, Karnataka 560001',
  }),
};
