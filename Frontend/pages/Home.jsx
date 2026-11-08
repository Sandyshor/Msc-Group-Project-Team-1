import './HomePage.css'
import HomeHero from './HomeHero'
import HomeFilm from './HomeFilm'
import HomeFaq from './HomeFaq'

function Home() {
  return (
    <div className="fd-home">
      <HomeHero />
      <HomeFilm />
      <HomeFaq />
    </div>
  )
}

export default Home
