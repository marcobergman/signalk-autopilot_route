# signalk-autopilot_route
Plugin that creates 'smooth' APB messages for Pyilot based on the Route Position Bearing algorithm. Primarily intended for PyPilot, this algorithm projects a fixed radius guide circle over the route, and steers towards the most forward intersection. This algorithm performs optimally in the vicinity of waypoints where the cross track error is not zero. If the resulting Heading to Steer (B) differs more than a maximum error angle from the route segment (A), it is clamped to that angle (C). 

<p align="center"><img width="872" height="380" alt="image" src="https://github.com/user-attachments/assets/98c3e5eb-9b96-4e22-9626-75ee25bd75ef" />
</p>

Plugin config seeting include Guide Radius (m) defaulting to 100m, Maximum Error Angle, defaulting to 20 degrees, and the Event Name that can be used as an Output Event in the Data Connection towards the NMEA0183 interface of a autopilot:

<p align="center"><img width="425" height="330" alt="image" src="https://github.com/user-attachments/assets/4666dd94-7b4f-4190-82d6-fea320eb35b4" /></p>

The web app is mainly for development purposes and it shows the current active route, boat position, guide circle and clamping results.

<p align="center"><img width="267" height="239" alt="image" src="https://github.com/user-attachments/assets/05cb5260-c6eb-406c-84e4-ecd3d5bb4100" /></p>

The plugin has been tested with, and is intended for use with FreeboardSK, but it effectively feeds off the data of the SignalK Course Provider plugin, meaning it runs within Signalk without any plotter being active. This way you can conserve battery energy by switching off your screens.

This plugin is entirely based on the eponymous OpenCPN plugin by Sean d'Epagnier. https://github.com/pypilot/workbook/wiki/Autopilot-Route-Plugin
