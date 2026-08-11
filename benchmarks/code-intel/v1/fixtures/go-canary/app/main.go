package main

import "example.com/lib/service"

func main() {
	var speaker service.Speaker = service.Greeter{}
	_ = speaker.Speak()
	_ = service.BuildMessage()
	_ = service.TaggedFeature()
}
