# OSRM routing server (Railway)

Road routes for every live map: the ST Partner app and the customer tracking page. The backend's
`GET /api/route` asks this server; nothing else talks to it directly.

## Set up once on Railway

1. In the Railway project, **New → GitHub Repo → SanathanaTattava** (same repo as the backend).
2. In the new service's **Settings → Source**, set **Root Directory** to `osrm`. Railway picks up
   `osrm/railway.json` and builds the Dockerfile (first build ≈ 5–10 min: it downloads South India
   from Geofabrik and cuts it to Bengaluru).
3. Name the service `osrm`. Don't give it a public domain; the backend reaches it privately.
4. In the **backend** service's **Variables**, add
   `OSRM_URL=http://osrm.railway.internal:${{osrm.PORT}}`
   (or `http://osrm.railway.internal:5000` if you set `PORT=5000` on the osrm service), then redeploy
   the backend.

Check it: `https://<backend>/api/route?from=12.9716,77.5946&to=12.9350,77.6100` returns `points`.
Until `OSRM_URL` is set the backend uses the public OSRM demo server, which is fine for testing but
not allowed for production traffic.

## Updating the map

Redeploy the `osrm` service every month or two to pull fresh OpenStreetMap data. To cover a wider
area, change `BBOX` in the Dockerfile (min lng, min lat, max lng, max lat).

Map data © OpenStreetMap contributors (ODbL).
