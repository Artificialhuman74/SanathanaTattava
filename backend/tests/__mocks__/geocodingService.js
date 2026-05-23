/** Mock geocoding — returns Bangalore coordinates for any address */
module.exports = {
  geocodeAddress: jest.fn().mockResolvedValue({
    latitude:    12.9716,
    longitude:   77.5946,
    h3_index:    '872be120fffffff',
    display_name:'Bangalore, Karnataka, India',
  }),
  geocodeFromCoordinates: jest.fn().mockResolvedValue({
    latitude:  12.9716,
    longitude: 77.5946,
    h3_index:  '872be120fffffff',
  }),
};
