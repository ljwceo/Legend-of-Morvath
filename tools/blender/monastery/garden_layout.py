# Garden layout of Monastery.blend (text block "MON_garden_layout"), monastery-local coordinates in metres.
# OUTER: the garden wall as Bo drew it (round the east side and behind the church, smoothed),
# INNER: the edge along the monastery buildings. Pond centre + ring path radius, the two streams and the pool.
OUTER_CONTROL = [(22.0, -17.0), (56.0, -17.0), (64.0, -13.0), (67.0, -5.0), (67.0, 38.0), (63.0, 46.5), (50.0, 50.5),
                 (10.0, 51.5), (-7.0, 50.5), (-14.5, 46.0), (-15.0, 36.0), (-15.0, 22.6)]   # smoothed 3x (Chaikin)
INNER = [(-15.0, 22.6), (10.0, 22.6), (14.3, 19.6), (14.3, 10.15), (22.05, 10.15), (22.05, -17.0)]
POND_C = (45.0, 14.0)
POND_RING = 12.5                       # radius of the gravel path round the pond
# pond edge radius: 8.5 + 1.5*sin(2a + 0.5) + 1.0*cos(3a); water surface at z = -0.18, deepest -0.95
INFLOW = [(62.0, 43.0), (59.5, 38.5), (57.0, 33.5), (54.5, 28.0), (52.0, 22.5), (50.5, 19.5)]    # from the spring (NE)
OUTFLOW = [(38.5, 16.0), (35.0, 19.0), (30.0, 23.5), (25.0, 28.0), (20.0, 32.5), (14.5, 35.5)]  # to the pool behind the church
POOL = ((11.5, 37.0), 2.8)
FARM_BEDS = {  # MON_FarmPlot_1..6: centre (x, y), 4.4 x 2.2 m raised beds
    1: ((36.0, -6.0), "Cabbage"), 2: ((44.0, -6.0), "Carrot"), 3: ((52.0, -6.0), "Pumpkin"),
    4: ((36.0, -12.0), "Wheat"), 5: ((44.0, -12.0), "Moonbell"), 6: ((52.0, -12.0), "Empty"),
}
