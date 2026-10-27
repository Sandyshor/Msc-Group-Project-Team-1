#!/usr/bin/env bash
# Creates the Azure VM that runs OpenTripPlanner, locked down so only the backend can reach port 8080.
# Run from a machine with the Azure CLI logged in (`az login`), or from Azure Cloud Shell.
#
# Fill in the settings below first (or export them as environment variables), then:
#   bash deploy/otp/azure-create-otp-vm.sh
set -euo pipefail

# ---------------------------------------------------------------- settings (edit these)
RESOURCE_GROUP="${RESOURCE_GROUP:-}"                 # existing resource group, e.g. crib-crew-rg
LOCATION="${LOCATION:-northeurope}"                  # same region as the backend
VNET_NAME="${VNET_NAME:-}"                           # existing virtual network (the one the Ollama VM uses)
OTP_SUBNET_NAME="${OTP_SUBNET_NAME:-otp-subnet}"     # created if it doesn't exist
OTP_SUBNET_PREFIX="${OTP_SUBNET_PREFIX:-10.0.3.0/24}"  # a free range inside the VNet
BACKEND_SOURCE_PREFIX="${BACKEND_SOURCE_PREFIX:-}"   # address range the backend calls FROM: the App Service
                                                     # integration subnet, or the backend VM's subnet
ADMIN_IP="${ADMIN_IP:-}"                             # your public IP for SSH (curl -s https://ifconfig.me)
VM_NAME="${VM_NAME:-otp-vm}"
VM_SIZE="${VM_SIZE:-Standard_B2ms}"                  # 8 GB RAM; OTP uses ~2.6 GB plus the OS
ADMIN_USER="${ADMIN_USER:-azureuser}"
# Public SSH key of the person who will run deploy-otp.sh (the laptop with graph.obj), e.g. the contents of
# ~/.ssh/id_ed25519.pub on that laptop. If empty, a key is generated on the machine running this script.
SSH_PUBLIC_KEY="${SSH_PUBLIC_KEY:-}"

# Optional: if the backend runs on App Service, set these and the script connects it to the VNet
# and sets OTP_URL for you. Leave WEBAPP_NAME empty if the backend runs on a VM.
WEBAPP_NAME="${WEBAPP_NAME:-}"                       # e.g. crib-crew-api
INTEGRATION_SUBNET_NAME="${INTEGRATION_SUBNET_NAME:-appservice-integration}"
INTEGRATION_SUBNET_PREFIX="${INTEGRATION_SUBNET_PREFIX:-10.0.4.0/26}"

# ---------------------------------------------------------------- checks
missing=()
for v in RESOURCE_GROUP VNET_NAME BACKEND_SOURCE_PREFIX ADMIN_IP; do
  [[ -n ${!v} ]] || missing+=("$v")
done
if (( ${#missing[@]} )); then
  echo "Set these first (edit the top of this script or export them): ${missing[*]}" >&2
  exit 1
fi
command -v az >/dev/null || { echo "Azure CLI not found. Install it or use Azure Cloud Shell." >&2; exit 1; }
az account show >/dev/null || { echo "Run 'az login' first." >&2; exit 1; }
NSG_NAME="$VM_NAME-nsg"

ensure_subnet() {  # name prefix
  if az network vnet subnet show -g "$RESOURCE_GROUP" --vnet-name "$VNET_NAME" -n "$1" >/dev/null 2>&1; then
    echo "Subnet $1 already exists."
  else
    echo "Creating subnet $1 ($2)..."
    az network vnet subnet create -g "$RESOURCE_GROUP" --vnet-name "$VNET_NAME" -n "$1" --address-prefixes "$2" -o none
  fi
}

# ---------------------------------------------------------------- network
ensure_subnet "$OTP_SUBNET_NAME" "$OTP_SUBNET_PREFIX"

echo "Creating firewall (NSG) $NSG_NAME: port 8080 only from $BACKEND_SOURCE_PREFIX, SSH only from $ADMIN_IP..."
az network nsg create -g "$RESOURCE_GROUP" -n "$NSG_NAME" -l "$LOCATION" -o none
az network nsg rule create -g "$RESOURCE_GROUP" --nsg-name "$NSG_NAME" -n allow-otp-from-backend \
  --priority 100 --direction Inbound --access Allow --protocol Tcp \
  --source-address-prefixes "$BACKEND_SOURCE_PREFIX" --destination-port-ranges 8080 -o none
az network nsg rule create -g "$RESOURCE_GROUP" --nsg-name "$NSG_NAME" -n allow-ssh-from-admin \
  --priority 110 --direction Inbound --access Allow --protocol Tcp \
  --source-address-prefixes "$ADMIN_IP/32" --destination-port-ranges 22 -o none

# ---------------------------------------------------------------- VM
if [[ -n $SSH_PUBLIC_KEY ]]; then
  ssh_args=(--ssh-key-values "$SSH_PUBLIC_KEY")
else
  echo "NOTE: SSH_PUBLIC_KEY not set - generating a key on THIS machine; only it can run deploy-otp.sh." >&2
  ssh_args=(--generate-ssh-keys)
fi
echo "Creating VM $VM_NAME ($VM_SIZE, Ubuntu 24.04)... this takes a few minutes."
az vm create -g "$RESOURCE_GROUP" -n "$VM_NAME" -l "$LOCATION" \
  --image Canonical:ubuntu-24_04-lts:server:latest --size "$VM_SIZE" \
  --vnet-name "$VNET_NAME" --subnet "$OTP_SUBNET_NAME" --nsg "$NSG_NAME" \
  --public-ip-sku Standard --admin-username "$ADMIN_USER" "${ssh_args[@]}" \
  --os-disk-size-gb 30 -o none

PRIVATE_IP=$(az vm show -d -g "$RESOURCE_GROUP" -n "$VM_NAME" --query privateIps -o tsv)
PUBLIC_IP=$(az vm show -d -g "$RESOURCE_GROUP" -n "$VM_NAME" --query publicIps -o tsv)
OTP_URL="http://$PRIVATE_IP:8080/otp/gtfs/v1"

# ---------------------------------------------------------------- backend connection (App Service)
if [[ -n $WEBAPP_NAME ]]; then
  ensure_subnet "$INTEGRATION_SUBNET_NAME" "$INTEGRATION_SUBNET_PREFIX"
  echo "Connecting App Service $WEBAPP_NAME to the VNet (needs Basic B1 or higher)..."
  az webapp vnet-integration add -g "$RESOURCE_GROUP" -n "$WEBAPP_NAME" --vnet "$VNET_NAME" --subnet "$INTEGRATION_SUBNET_NAME" -o none
  az webapp config appsettings set -g "$RESOURCE_GROUP" -n "$WEBAPP_NAME" --settings "OTP_URL=$OTP_URL" -o none
  echo "Set OTP_URL on $WEBAPP_NAME (the app restarts automatically)."
  [[ $BACKEND_SOURCE_PREFIX == "$INTEGRATION_SUBNET_PREFIX" ]] || \
    echo "NOTE: BACKEND_SOURCE_PREFIX ($BACKEND_SOURCE_PREFIX) differs from the integration subnet ($INTEGRATION_SUBNET_PREFIX); App Service calls come from the integration subnet." >&2
fi

cat <<EOF

Done.
  VM public IP (SSH only, from $ADMIN_IP): $PUBLIC_IP
  OTP address for the backend:            $OTP_URL

Next, from the laptop that has ~/dublin-otp:
  bash deploy/otp/deploy-otp.sh $ADMIN_USER@$PUBLIC_IP
EOF
[[ -n $WEBAPP_NAME ]] || echo "Then set OTP_URL=$OTP_URL in the backend VM's environment and restart the backend."
