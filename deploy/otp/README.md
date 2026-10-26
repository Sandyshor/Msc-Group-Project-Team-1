# Hosting OpenTripPlanner on Azure

The journey planner (`/route` in the backend, `route.html` in the frontend) needs an
OpenTripPlanner (OTP) server. Locally it runs on your laptop; online it runs on its own Azure VM
that only the backend can reach.

```
Browser ──► Static Web App (route.html)
              │ HTTPS
              ▼
        Backend /route (App Service or VM) ──private network, port 8080──► OTP VM
```

OTP does not download anything while it runs. Every journey is answered from `graph.obj`, which is
built once from OpenStreetMap + the TFI GTFS timetables. Deploying OTP means copying two files to
the VM and running them.

| File | Size | Where it comes from |
|---|---|---|
| `otp-shaded-2.10.0.jar` | 183 MB | `~/dublin-otp` on the laptop that built the graph |
| `graph.obj` | 183 MB | same folder (built by that exact jar) |

Use the jar from the laptop, not a fresh download: a graph only loads in the OTP build that created it.

## What's in this folder

| File | Runs on | What it does |
|---|---|---|
| `azure-create-otp-vm.sh` | your laptop or Azure Cloud Shell | Creates the VM, its subnet and firewall; optionally connects the App Service and sets `OTP_URL` |
| `deploy-otp.sh` | your laptop | Uploads the jar + graph to the VM and starts OTP |
| `setup-otp-vm.sh` | the VM (run for you by `deploy-otp.sh`) | Installs Java 25, installs OTP as a service, checks it answers |
| `otp.service` | the VM | Keeps OTP running and restarts it after crashes or reboots |

## One-time setup

You need: the Azure CLI logged in (`az login`), the backend's resource group and virtual network
names, and the laptop with `~/dublin-otp`.

1. **Find your public IP** (SSH to the VM will only be allowed from it):
   `curl -s https://ifconfig.me`

2. **Edit the settings at the top of `azure-create-otp-vm.sh`**:
   - `RESOURCE_GROUP`, `LOCATION`, `VNET_NAME` – the ones the backend / Ollama VM already use.
   - `ADMIN_IP` – from step 1.
   - Backend on **App Service**: set `WEBAPP_NAME` (e.g. `crib-crew-api`) and set
     `BACKEND_SOURCE_PREFIX` to the same value as `INTEGRATION_SUBNET_PREFIX`.
     The App Service plan must be Basic (B1) or higher; the free F1 plan cannot join a VNet.
   - Backend on a **VM**: leave `WEBAPP_NAME` empty and set `BACKEND_SOURCE_PREFIX` to the
     backend VM's subnet (e.g. `10.0.1.0/24`).
   - Pick subnet ranges that are free in your VNet (`az network vnet show -g <rg> -n <vnet> --query addressSpace`).

3. **Create the VM** (about 5 minutes):
   `bash deploy/otp/azure-create-otp-vm.sh`
   It prints the VM's public IP and the `OTP_URL` for the backend.

4. **Upload and start OTP** (from the laptop with `~/dublin-otp`):
   `bash deploy/otp/deploy-otp.sh azureuser@<vm-public-ip>`
   It finishes with `OTP is up: http://10.0.3.x:8080/otp/gtfs/v1`. Loading the graph takes a minute or two.

5. **Point the backend at OTP**:
   - App Service: already done by step 3 (`OTP_URL` app setting).
   - Backend VM: add `OTP_URL=http://<otp-private-ip>:8080/otp/gtfs/v1` to its environment and restart the backend.

6. **Test**: open the website's journey planner and click two points. If it says
   "journey planner is offline", see Troubleshooting.

## Updating the timetables

TFI changes timetables regularly. Every few months:

1. Download the latest GTFS from TFI into `~/dublin-otp` (replace `GTFS_All.zip`), and optionally a fresh `Dublin.osm.pbf`.
2. Rebuild the graph on the laptop (stop the local OTP first):
   `cd ~/dublin-otp && java -Xmx6G -jar otp-shaded-2.10.0.jar --build --save .`
3. Upload it: `bash deploy/otp/deploy-otp.sh azureuser@<vm-public-ip>`
   (only the changed graph is sent; OTP restarts with the new timetables).
4. Refresh the recommender's commute times with the same graph (local OTP running on port 8080):
   `cd Backend && OTP_URL=http://localhost:8080/otp/gtfs/v1 python tools/build_commute_matrix.py`
   This writes `Data/commute_otp.csv` (public transport arriving by 09:00 on a weekday, walking and
   cycling, from 5 points in every district to every university). Commit it in a pull request; the
   recommender uses it automatically and falls back to the older Journey Planner data without it.

## Security

- Port 8080 is never open to the internet: the firewall allows it only from the backend's subnet.
- SSH (port 22) is allowed only from `ADMIN_IP`. If your IP changes:
  `az network nsg rule update -g <rg> --nsg-name otp-vm-nsg -n allow-ssh-from-admin --source-address-prefixes <new-ip>/32`
- OTP runs as its own unprivileged `otp` user.
- Don't commit `graph.obj` or the jar to Git (they're large and built artefacts).

## Cost

The VM is billed while it runs (check `Standard_B2ms` in the Azure pricing calculator). To pause
billing for compute when nobody needs the planner: `az vm deallocate -g <rg> -n otp-vm`
(the planner shows "offline" until you `az vm start -g <rg> -n otp-vm`; OTP starts by itself).

## Troubleshooting

On the VM (`ssh azureuser@<vm-public-ip>`):

| Check | Command |
|---|---|
| Is OTP running? | `systemctl status otp` |
| Live logs | `journalctl -u otp -f` |
| Does it answer? | `curl -s -H 'Content-Type: application/json' -d '{"query":"{feeds{feedId}}"}' http://127.0.0.1:8080/otp/gtfs/v1` |

From the backend: the same `curl` against `http://<otp-private-ip>:8080/otp/gtfs/v1`. If it times out,
check `BACKEND_SOURCE_PREFIX` matches where the backend's traffic comes from, and (App Service) that
VNet integration is listed: `az webapp vnet-integration list -g <rg> -n <app>`.

Graph won't load ("incompatible graph" in the logs): the jar on the VM isn't the one that built
`graph.obj`. Re-run `deploy-otp.sh` from the laptop that built it.
