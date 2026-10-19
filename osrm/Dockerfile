# OSRM road routing for ST's live maps (the backend's GET /api/route calls this).
# Orders are Bengaluru-only, so the build cuts the South India map down to the Bengaluru area:
# a small graph that builds in minutes and runs in well under 1 GB of memory.
# Rebuild (redeploy) every month or two to pick up new roads.

ARG OSRM_IMAGE=ghcr.io/project-osrm/osrm-backend:v5.27.1

FROM ${OSRM_IMAGE} AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl osmium-tool \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /data
# South India from Geofabrik, clipped to greater Bengaluru (min lng, min lat, max lng, max lat).
ARG PBF_URL=https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf
ARG BBOX=77.30,12.70,77.95,13.25
RUN curl -fSL --retry 3 -o region.osm.pbf "$PBF_URL" \
 && osmium extract --bbox "$BBOX" --strategy complete_ways region.osm.pbf -o city.osm.pbf \
 && rm region.osm.pbf
# Car profile: closest to scooters and bikes on Bengaluru roads.
RUN osrm-extract -p /opt/car.lua city.osm.pbf \
 && osrm-partition city.osrm \
 && osrm-customize city.osrm \
 && rm city.osm.pbf

FROM ${OSRM_IMAGE}
COPY --from=build /data /data
EXPOSE 5000
# Railway sets PORT; listen on all interfaces (IPv6 too) so the private network reaches it.
CMD ["sh", "-c", "exec osrm-routed --algorithm mld --ip :: --port ${PORT:-5000} --max-viaroute-size 50 /data/city.osrm"]
