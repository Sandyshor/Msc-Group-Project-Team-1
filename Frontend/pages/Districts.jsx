import { useLocation, useSearchParams } from 'react-router-dom'
import DistrictProfile from '../District Profile/App.jsx'

// Opens on the district picked on the home page search (?district=D7) or from a
// result card (router state), otherwise the profile's default.
function Districts() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const district = location.state?.district ?? searchParams.get('district') ?? undefined

  return <DistrictProfile key={location.key} initialDistrictId={district?.toUpperCase()} />
}

export default Districts
